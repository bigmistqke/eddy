// bitmap-series — does the flow design's "low-res bitmap series as
// gap-filler" hold up end-to-end?
//
// Three things to validate:
//   1. Build is cheap (much faster than ~1.2× atlas rebuild).
//   2. Per-frame paint cost is small enough that K bitmap cells fit in
//      the renderer's budget alongside atlas decode.
//   3. Bitmap build + paint don't fold under contention with capture +
//      atlas decoder running (the production shape: a take ending while
//      the previous take's atlas is still rebuilding, etc.).

import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from "mediabunny"
import { wait } from "../../src/utils"
import { composite } from "../harness/composite"
import { recordProbeInput, type ProbeInput } from "../harness/input"
import { reportResult, status } from "../harness/report"

const params = {
  captureResolution: { width: 1280, height: 720 },
  // CSS-pixel atlas, matching 10/11's verdict for the pre-baked side.
  atlasResolution: { width: 540, height: 983 },
  // Cell-sized bitmap. 96×174 ≈ 1/16 of the CSS viewport (~the size of
  // a single cell in an N=16 layout). Intentionally blurry — the user
  // said preview quality isn't top of the list.
  bitmapResolution: { width: 96, height: 174 },
  // K bitmap cells painting concurrently. Models several pending takes
  // queued up (each take = one stream-over / bitmap-paint workload).
  bitmapCellCounts: [1, 4, 8],
  recordSeconds: 4,
  runSeconds: 4,
  maxQueue: 8,
  realtimeFps: 28,
}

interface BuildResponse {
  buildMs: number
  bitmaps: ImageBitmap[]
  bitmapWidth: number
  bitmapHeight: number
}

function buildBitmapsInWorker(source: ProbeInput): {
  done: Promise<BuildResponse>
  terminate(): void
} {
  const worker = new Worker(new URL("./bitmap-worker.ts", import.meta.url), { type: "module" })
  const { promise, resolve, reject } = Promise.withResolvers<BuildResponse>()
  worker.onmessage = (event: MessageEvent<BuildResponse>) => {
    resolve(event.data)
  }
  worker.onerror = error => {
    reject(error)
  }
  worker.postMessage({
    source,
    bitmapWidth: params.bitmapResolution.width,
    bitmapHeight: params.bitmapResolution.height,
  })
  return { done: promise, terminate: () => worker.terminate() }
}

/** A throwaway WebGL2 context that uploads a bitmap and draws a quad —
 *  mirrors what the production renderer will do per cell per frame. */
function makePainter(width: number, height: number): {
  paint(bitmap: ImageBitmap): void
  finish(): void
  dispose(): void
} {
  const canvas = new OffscreenCanvas(width, height)
  const gl = canvas.getContext("webgl2")
  if (gl === null) {
    throw new Error("makePainter: no webgl2 context")
  }
  const vs = gl.createShader(gl.VERTEX_SHADER)!
  gl.shaderSource(
    vs,
    `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0, 1); }`,
  )
  gl.compileShader(vs)
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!
  gl.shaderSource(
    fs,
    `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main() { outColor = texture(uTex, vUv); }`,
  )
  gl.compileShader(fs)
  const program = gl.createProgram()!
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.useProgram(program)
  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW)
  const attribLocation = gl.getAttribLocation(program, "aPos")
  gl.enableVertexAttribArray(attribLocation)
  gl.vertexAttribPointer(attribLocation, 2, gl.FLOAT, false, 0, 0)
  const texture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  return {
    paint(bitmap) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bitmap)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    },
    finish() {
      gl.finish()
    },
    dispose() {
      gl.deleteTexture(texture)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vs)
      gl.deleteShader(fs)
    },
  }
}

interface PaintPass {
  k: number
  framesPainted: number
  paintedFps: number
  msPerFrame: number
}

/** Simulate a per-frame render loop: each frame, paint K cells from
 *  the bitmap series, force gl.finish() so timings reflect real GPU
 *  cost. Loop for `runSeconds`. Reports fps + avg ms per frame. */
async function runPaintPass(
  bitmaps: ImageBitmap[],
  k: number,
  runSeconds: number,
): Promise<PaintPass> {
  const painters = Array.from({ length: k }, () =>
    makePainter(params.bitmapResolution.width, params.bitmapResolution.height),
  )
  const deadline = performance.now() + runSeconds * 1000
  let frames = 0
  const start = performance.now()
  let cursor = 0
  while (performance.now() < deadline) {
    for (const painter of painters) {
      painter.paint(bitmaps[cursor % bitmaps.length])
    }
    painters[painters.length - 1].finish()
    frames++
    cursor++
    // Yield so the event loop can do something else (transport timer,
    // capture callbacks, etc.) — matches a real rAF-driven render.
    await wait(0)
  }
  const elapsedSeconds = (performance.now() - start) / 1000
  for (const painter of painters) {
    painter.dispose()
  }
  return {
    k,
    framesPainted: frames,
    paintedFps: frames / elapsedSeconds,
    msPerFrame: (elapsedSeconds * 1000) / frames,
  }
}

interface CaptureSample {
  frames: number
  blobBytes: number
}

async function captureForSeconds(seconds: number): Promise<CaptureSample> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: params.captureResolution.width, height: params.captureResolution.height },
    audio: true,
  })
  const mimeType = "video/webm;codecs=vp8,opus"
  const recorder = new MediaRecorder(stream, { mimeType })
  const blobParts: Blob[] = []
  recorder.ondataavailable = event => {
    if (event.data.size > 0) {
      blobParts.push(event.data)
    }
  }
  const { promise: stopped, resolve: onStopped } = Promise.withResolvers<void>()
  recorder.onstop = () => {
    onStopped()
  }
  recorder.start()
  await wait(seconds * 1000)
  recorder.stop()
  await stopped
  for (const track of stream.getTracks()) {
    track.stop()
  }
  const blob = new Blob(blobParts, { type: mimeType })
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  const videoTrack = await input.getPrimaryVideoTrack()
  if (videoTrack === null) {
    throw new Error("captureForSeconds: no video track")
  }
  const sink = new EncodedPacketSink(videoTrack)
  let frames = 0
  for await (const _packet of sink.packets()) {
    frames++
  }
  return { frames, blobBytes: blob.size }
}

async function runAtlasDecoder(atlas: ProbeInput, deadline: number): Promise<number> {
  let decoded = 0
  const decoder = new VideoDecoder({
    output(frame) {
      decoded++
      frame.close()
    },
    error() {},
  })
  decoder.configure(atlas.config)
  while (performance.now() < deadline) {
    for (const chunk of atlas.chunks) {
      if (performance.now() >= deadline) {
        break
      }
      decoder.decode(chunk)
      while (decoder.decodeQueueSize > params.maxQueue) {
        await wait(1)
      }
    }
    await decoder.flush()
    decoder.reset()
    decoder.configure(atlas.config)
  }
  decoder.close()
  return decoded
}

interface ContendedPass {
  captureFrames: number
  captureBytes: number
  atlasFps: number
  paint: PaintPass
  bitmapBuildMs: number
  bitmapBuildRateVsRealtime: number
  bitmapBuildCompletedInWindow: boolean
}

async function runContendedPass(
  source: ProbeInput,
  atlas: ProbeInput,
  bitmaps: ImageBitmap[],
  k: number,
  runSeconds: number,
): Promise<ContendedPass> {
  const deadline = performance.now() + runSeconds * 1000
  const buildStart = performance.now()
  const build = buildBitmapsInWorker(source)
  let buildResponse: BuildResponse | null = null
  let bitmapBuildCompletedInWindow = false
  build.done.then(response => {
    buildResponse = response
    if (performance.now() <= deadline) {
      bitmapBuildCompletedInWindow = true
    }
  })
  const atlasStart = performance.now()
  const [capture, atlasCount, paint] = await Promise.all([
    captureForSeconds(runSeconds),
    runAtlasDecoder(atlas, deadline),
    runPaintPass(bitmaps, k, runSeconds),
  ])
  const atlasElapsed = (performance.now() - atlasStart) / 1000
  if (buildResponse === null) {
    buildResponse = await build.done
  }
  build.terminate()
  // Free the rebuilt bitmaps — we already have the originals for paint.
  for (const bitmap of buildResponse.bitmaps) {
    bitmap.close()
  }
  const buildWallClock = (performance.now() - buildStart) / 1000
  return {
    captureFrames: capture.frames,
    captureBytes: capture.blobBytes,
    atlasFps: atlasCount / atlasElapsed,
    paint,
    bitmapBuildMs: buildResponse.buildMs,
    bitmapBuildRateVsRealtime: buildWallClock / params.recordSeconds,
    bitmapBuildCompletedInWindow,
  }
}

interface KResult {
  k: number
  baselinePaint: PaintPass & { realtimeOk: boolean }
  contended: ContendedPass & { paintRealtimeOk: boolean }
}

async function run(): Promise<void> {
  status(`recording source clip (${params.recordSeconds}s)...`)
  const source = await recordProbeInput(
    params.captureResolution.width,
    params.captureResolution.height,
    params.recordSeconds,
  )
  status(`  got ${source.width}x${source.height}, ${source.chunks.length} chunks`)

  status(`pre-building bitmap series (${params.bitmapResolution.width}x${params.bitmapResolution.height})...`)
  const initial = buildBitmapsInWorker(source)
  const bitmapResponse = await initial.done
  initial.terminate()
  status(
    `  built ${bitmapResponse.bitmaps.length} bitmaps in ${bitmapResponse.buildMs.toFixed(0)}ms ` +
      `(rate ${(bitmapResponse.buildMs / 1000 / params.recordSeconds).toFixed(2)}× realtime)`,
  )

  status(`pre-baking atlas (${params.atlasResolution.width}x${params.atlasResolution.height})...`)
  const atlas = await composite(
    source,
    4,
    4,
    params.atlasResolution.width,
    params.atlasResolution.height,
  )
  status(`  atlas ${atlas.output.width}x${atlas.output.height} built in ${atlas.compositeMs.toFixed(0)}ms`)

  const ks: KResult[] = []
  for (const k of params.bitmapCellCounts) {
    status(`K=${k}: BASELINE paint pass (no contention)...`)
    const baseline = await runPaintPass(bitmapResponse.bitmaps, k, params.runSeconds)
    status(
      `  paint K=${k}: ${baseline.framesPainted}f, ${baseline.paintedFps.toFixed(1)}fps, ${baseline.msPerFrame.toFixed(2)}ms/frame`,
    )

    status(`K=${k}: CONTENDED — capture + atlas decoder + ${k} bitmap paints + worker rebuilds bitmaps...`)
    const contended = await runContendedPass(
      source,
      atlas.output,
      bitmapResponse.bitmaps,
      k,
      params.runSeconds,
    )
    status(
      `  contended K=${k}: cap ${contended.captureFrames}f, atlasFps ${contended.atlasFps.toFixed(1)}, ` +
        `paintFps ${contended.paint.paintedFps.toFixed(1)}, bitmapBuild ${contended.bitmapBuildMs.toFixed(0)}ms ` +
        `(${contended.bitmapBuildRateVsRealtime.toFixed(2)}×)`,
    )

    ks.push({
      k,
      baselinePaint: { ...baseline, realtimeOk: baseline.paintedFps >= params.realtimeFps },
      contended: {
        ...contended,
        paintRealtimeOk: contended.paint.paintedFps >= params.realtimeFps,
      },
    })
  }
  status("done.")
  reportResult("bitmap-series", params, {
    initialBuild: {
      ms: bitmapResponse.buildMs,
      framesProduced: bitmapResponse.bitmaps.length,
      bitmap: `${bitmapResponse.bitmapWidth}x${bitmapResponse.bitmapHeight}`,
      rateVsRealtime: bitmapResponse.buildMs / 1000 / params.recordSeconds,
    },
    ks,
  })
}

run().catch((error: unknown) => {
  status(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  reportResult("bitmap-series", params, {
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  })
})
