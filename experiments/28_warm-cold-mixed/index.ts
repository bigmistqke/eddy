// warm-cold-mixed — bitmap render of M=8 cells + 4 cells in
// concurrent cold-start (AV1→RGBA via copyTo workers). Three
// isolating passes for attribution.

import { wait } from "../../src/utils"
import { recordProbeInput, type ProbeInput } from "../harness/input"
import {
  JankRecorder,
  observeLongTasks,
  type JankReport,
  type LongTaskReport,
} from "../harness/jank"
import { reportResult, status } from "../harness/report"

const params = {
  captureResolution: { width: 1280, height: 720 },
  sourceSeconds: 6,
  runSeconds: 15,
  coldStartAtMs: 2000,
  framesPerCell: 60,
  sourceFps: 30,
  bitratePerPixel: 0.1,
  swCodec: { label: "av1", codecString: "av01.0.04M.08" },
  opfsDirName: "28",
  m: 8,
  coldCells: 4,
  gridCols: 4,
  gridRows: 3, // 4×3 = 12 cells; first 8 are warm, last 4 are cold-start
  cellMip: { label: "270p", width: 480, height: 272 },
  passes: [
    { label: "baseline", render: true, coldStart: false },
    { label: "cold-start-only", render: false, coldStart: true },
    { label: "full", render: true, coldStart: true },
  ],
}

const snap16 = (value: number): number => Math.max(16, Math.round(value / 16) * 16)

interface DecodedStream {
  width: number
  height: number
  frames: Uint8Array[]
}

async function decodeToRgba(
  source: ProbeInput,
  targetW: number,
  targetH: number,
  maxFrames: number,
): Promise<DecodedStream | null> {
  const width = snap16(targetW)
  const height = snap16(targetH)
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext("2d")
  if (context === null) {
    return null
  }
  const frames: Uint8Array[] = []
  const decoder = new VideoDecoder({
    output(frame) {
      if (frames.length >= maxFrames) {
        frame.close()
        return
      }
      try {
        context.drawImage(frame, 0, 0, width, height)
        const imageData = context.getImageData(0, 0, width, height)
        frames.push(new Uint8Array(imageData.data.buffer.slice(0)))
      } catch {}
      frame.close()
    },
    error() {},
  })
  decoder.configure(source.config)
  for (const chunk of source.chunks) {
    if (frames.length >= maxFrames) {
      break
    }
    decoder.decode(chunk)
  }
  try {
    await decoder.flush()
  } catch {}
  decoder.close()
  if (frames.length === 0) {
    return null
  }
  return { width, height, frames }
}

interface Av1Asset {
  width: number
  height: number
  config: VideoDecoderConfig
  chunks: EncodedVideoChunk[]
}

async function transcodeToAv1(
  source: ProbeInput,
  targetW: number,
  targetH: number,
  maxFrames: number,
): Promise<Av1Asset | null> {
  const width = snap16(targetW)
  const height = snap16(targetH)
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext("2d")
  if (context === null) {
    return null
  }
  const chunks: EncodedVideoChunk[] = []
  let decoderConfig: VideoDecoderConfig | null = null
  const bitrate = Math.round(width * height * 30 * params.bitratePerPixel)
  const encoder = new VideoEncoder({
    output(chunk, metadata) {
      chunks.push(chunk)
      if (decoderConfig === null && metadata?.decoderConfig) {
        decoderConfig = metadata.decoderConfig
      }
    },
    error() {},
  })
  try {
    encoder.configure({
      codec: params.swCodec.codecString,
      width,
      height,
      bitrate,
      framerate: 30,
    })
  } catch {
    encoder.close()
    return null
  }
  let frameIdx = 0
  const sourceDecoder = new VideoDecoder({
    output(frame) {
      if (frameIdx >= maxFrames) {
        frame.close()
        return
      }
      try {
        context.drawImage(frame, 0, 0, width, height)
        const scaled = new VideoFrame(canvas, { timestamp: frame.timestamp })
        encoder.encode(scaled, { keyFrame: frameIdx === 0 })
        scaled.close()
      } catch {}
      frame.close()
      frameIdx++
    },
    error() {},
  })
  sourceDecoder.configure(source.config)
  for (const chunk of source.chunks) {
    if (frameIdx >= maxFrames) {
      break
    }
    sourceDecoder.decode(chunk)
  }
  try {
    await sourceDecoder.flush()
  } catch {}
  sourceDecoder.close()
  try {
    await encoder.flush()
  } catch {}
  encoder.close()
  if (chunks.length === 0 || decoderConfig === null) {
    return null
  }
  return { width, height, config: decoderConfig, chunks }
}

async function writeRgbaFiles(
  frames: Uint8Array[],
  m: number,
  mipLabel: string,
): Promise<string[]> {
  const root = await navigator.storage.getDirectory()
  const dir = await root.getDirectoryHandle(params.opfsDirName, { create: true })
  const fileNames: string[] = []
  for (let i = 0; i < m; i++) {
    const fileName = `${mipLabel}-warm-${i}-rgba.bin`
    const fileHandle = await dir.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable({ keepExistingData: false })
    for (const frame of frames) {
      await writable.write(frame)
    }
    await writable.close()
    fileNames.push(fileName)
  }
  return fileNames
}

async function writeAv1Files(asset: Av1Asset, count: number, mipLabel: string): Promise<string[]> {
  const root = await navigator.storage.getDirectory()
  const dir = await root.getDirectoryHandle(params.opfsDirName, { create: true })
  const totalLen = asset.chunks.reduce((s, c) => s + 4 + c.byteLength, 0)
  const buf = new Uint8Array(totalLen)
  const view = new DataView(buf.buffer)
  let off = 0
  for (const chunk of asset.chunks) {
    view.setUint32(off, chunk.byteLength, false)
    off += 4
    const tmp = new Uint8Array(chunk.byteLength)
    chunk.copyTo(tmp)
    buf.set(tmp, off)
    off += chunk.byteLength
  }
  const fileNames: string[] = []
  for (let i = 0; i < count; i++) {
    const fileName = `${mipLabel}-cold-${i}-av1.bin`
    const fileHandle = await dir.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable({ keepExistingData: false })
    await writable.write(buf)
    await writable.close()
    fileNames.push(fileName)
  }
  return fileNames
}

async function cleanupOpfs(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory()
    await root.removeEntry(params.opfsDirName, { recursive: true })
  } catch {}
}

interface CellResult {
  cellId: number
  framesProduced: number
  decodeMs: number
  writeMs: number
  totalMs: number
  errors: string[]
}

function spawnWarmWorker(
  cellId: number,
  av1FileName: string,
  rgbaFileName: string,
  config: VideoDecoderConfig,
  width: number,
  height: number,
): Promise<CellResult> {
  const worker = new Worker(
    new URL("../26b_cold-start-copyto-workers/warm-worker.ts", import.meta.url),
    { type: "module" },
  )
  const { promise, resolve } = Promise.withResolvers<CellResult>()
  worker.onmessage = (event: MessageEvent<{
    type: "done"
    cellId: number
    framesProduced: number
    decodeMs: number
    writeMs: number
    totalMs: number
    errors: string[]
  }>) => {
    if (event.data.type === "done") {
      const { framesProduced, decodeMs, writeMs, totalMs, errors } = event.data
      resolve({ cellId, framesProduced, decodeMs, writeMs, totalMs, errors })
      worker.terminate()
    }
  }
  worker.postMessage({
    type: "warm",
    cellId,
    dirName: params.opfsDirName,
    av1FileName,
    rgbaFileName,
    config,
    width,
    height,
  })
  return promise
}

interface ReaderWorkerHandle {
  worker: Worker
  ready: Promise<void>
  donePromise: Promise<void>
}

function spawnReaderWorker(
  fileNames: string[],
  mipWidth: number,
  mipHeight: number,
  onFrames: (frames: { cellId: number; bytes: Uint8Array }[]) => void,
): ReaderWorkerHandle {
  const worker = new Worker(
    new URL("../24g_opfs-bitmap-render/bitmap-reader-worker.ts", import.meta.url),
    { type: "module" },
  )
  const { promise: ready, resolve: resolveReady } = Promise.withResolvers<void>()
  const { promise: donePromise, resolve: resolveDone } = Promise.withResolvers<void>()
  worker.onmessage = (
    event: MessageEvent<
      | { type: "ready" }
      | { type: "frames"; frames: { cellId: number; bytes: ArrayBuffer }[] }
      | { type: "done"; framesDelivered: Record<number, number> }
    >,
  ) => {
    const msg = event.data
    if (msg.type === "ready") {
      resolveReady()
      return
    }
    if (msg.type === "frames") {
      onFrames(msg.frames.map(f => ({ cellId: f.cellId, bytes: new Uint8Array(f.bytes) })))
      return
    }
    if (msg.type === "done") {
      resolveDone()
      return
    }
  }
  worker.postMessage({
    type: "init",
    dirName: params.opfsDirName,
    cells: fileNames.map((fileName, cellId) => ({
      cellId,
      fileName,
      frameSize: mipWidth * mipHeight * 4,
      totalFrames: params.framesPerCell,
    })),
    sourceFps: params.sourceFps,
  })
  return { worker, ready, donePromise }
}

interface PassResult {
  label: string
  renderEnabled: boolean
  coldStartEnabled: boolean
  jank: JankReport | null
  longTasks: LongTaskReport | null
  emptyCellTicks: number | null
  coldStartMs: number | null
  coldStartCellResults: CellResult[] | null
}

async function runPass(
  pass: (typeof params.passes)[number],
  warmFileNames: string[],
  coldAv1FileNames: string[],
  av1Config: VideoDecoderConfig,
  mipWidth: number,
  mipHeight: number,
): Promise<PassResult> {
  const latestBytes: Map<number, Uint8Array> = new Map()
  let readerHandle: ReaderWorkerHandle | null = null
  if (pass.render) {
    readerHandle = spawnReaderWorker(warmFileNames, mipWidth, mipHeight, frames => {
      for (const { cellId, bytes } of frames) {
        latestBytes.set(cellId, bytes)
      }
    })
    await readerHandle.ready
    // Wait briefly for initial frames.
    const waitDeadline = performance.now() + 500
    while (performance.now() < waitDeadline && latestBytes.size < params.m) {
      await wait(10)
    }
  }

  // GL setup if rendering.
  let canvas: HTMLCanvasElement | null = null
  let gl: WebGL2RenderingContext | null = null
  let textures: WebGLTexture[] = []
  let uNdcOffset: WebGLUniformLocation | null = null
  let uNdcScale: WebGLUniformLocation | null = null
  let cleanupGl: (() => void) | null = null
  if (pass.render) {
    canvas = document.createElement("canvas")
    canvas.width = window.innerWidth * (window.devicePixelRatio || 1)
    canvas.height = window.innerHeight * (window.devicePixelRatio || 1)
    canvas.style.cssText =
      "position:fixed;inset:0;width:100vw;height:100vh;z-index:0;display:block"
    document.body.appendChild(canvas)
    const glOrNull = canvas.getContext("webgl2")
    if (glOrNull === null) {
      document.body.removeChild(canvas)
      throw new Error("no webgl2")
    }
    gl = glOrNull
    const vs = gl.createShader(gl.VERTEX_SHADER)!
    gl.shaderSource(
      vs,
      `#version 300 es
in vec2 aQuad;
uniform vec2 uNdcOffset;
uniform vec2 uNdcScale;
out vec2 vUv;
void main() {
  vec2 corner = (aQuad + 1.0) * 0.5;
  vUv = vec2(corner.x, 1.0 - corner.y);
  gl_Position = vec4(uNdcOffset + corner * uNdcScale, 0.0, 1.0);
}`,
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
    const aQuad = gl.getAttribLocation(program, "aQuad")
    gl.enableVertexAttribArray(aQuad)
    gl.vertexAttribPointer(aQuad, 2, gl.FLOAT, false, 0, 0)
    uNdcOffset = gl.getUniformLocation(program, "uNdcOffset")
    uNdcScale = gl.getUniformLocation(program, "uNdcScale")
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)
    for (let i = 0; i < params.m; i++) {
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      textures.push(tex)
    }
    cleanupGl = () => {
      for (const tex of textures) {
        gl!.deleteTexture(tex)
      }
      gl!.deleteBuffer(buffer)
      gl!.deleteProgram(program)
      gl!.deleteShader(vs)
      gl!.deleteShader(fs)
      document.body.removeChild(canvas!)
    }
  }

  // Cold-start promise: kicks off at coldStartAtMs if enabled.
  let coldStartPromise: Promise<CellResult[]> | null = null
  let coldStartMs: number | null = null
  let coldStartCellResults: CellResult[] | null = null

  const recorder = pass.render ? new JankRecorder() : null
  const longTasks = pass.render ? observeLongTasks() : null
  const deadline = performance.now() + params.runSeconds * 1000
  const startWall = performance.now()
  const viewportCellW = 2 / params.gridCols
  const viewportCellH = 2 / params.gridRows
  let emptyCellTicks = 0
  let coldStartFired = false

  async function fireColdStart(): Promise<CellResult[]> {
    const coldStartStart = performance.now()
    const results = await Promise.all(
      coldAv1FileNames.map((fn, i) =>
        spawnWarmWorker(
          i,
          fn,
          fn.replace("-av1.bin", "-rgba.bin"),
          av1Config,
          mipWidth,
          mipHeight,
        ),
      ),
    )
    coldStartMs = performance.now() - coldStartStart
    coldStartCellResults = results
    return results
  }

  if (pass.render) {
    await new Promise<void>(resolveLoop => {
      function tick(now: number) {
        if (now >= deadline) {
          resolveLoop()
          return
        }
        recorder!.mark(now)
        const elapsedMs = now - startWall
        if (pass.coldStart && !coldStartFired && elapsedMs >= params.coldStartAtMs) {
          coldStartFired = true
          coldStartPromise = fireColdStart()
        }
        gl!.clear(gl!.COLOR_BUFFER_BIT)
        for (let i = 0; i < params.m; i++) {
          const bytes = latestBytes.get(i)
          if (bytes === undefined) {
            emptyCellTicks++
            continue
          }
          gl!.bindTexture(gl!.TEXTURE_2D, textures[i])
          gl!.texImage2D(
            gl!.TEXTURE_2D,
            0,
            gl!.RGBA,
            mipWidth,
            mipHeight,
            0,
            gl!.RGBA,
            gl!.UNSIGNED_BYTE,
            bytes,
          )
          const row = Math.floor(i / params.gridCols)
          const col = i % params.gridCols
          gl!.uniform2f(uNdcOffset, -1 + col * viewportCellW, 1 - (row + 1) * viewportCellH)
          gl!.uniform2f(uNdcScale, viewportCellW, viewportCellH)
          gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4)
        }
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
  } else if (pass.coldStart) {
    // Cold-start-only: kick off immediately, await completion (or runSeconds).
    coldStartFired = true
    coldStartPromise = fireColdStart()
    await Promise.race([coldStartPromise, wait(params.runSeconds * 1000)])
  }

  // If cold-start fired but not yet completed, wait briefly.
  if (coldStartPromise !== null && coldStartMs === null) {
    await Promise.race([coldStartPromise, wait(15000)])
  }

  const longTaskReport = longTasks ? longTasks.stop() : null
  const jank = recorder ? recorder.snapshot() : null

  if (cleanupGl !== null) {
    cleanupGl()
  }
  if (readerHandle !== null) {
    readerHandle.worker.postMessage({ type: "stop" })
    await Promise.race([readerHandle.donePromise, wait(2000)])
    readerHandle.worker.terminate()
  }

  return {
    label: pass.label,
    renderEnabled: pass.render,
    coldStartEnabled: pass.coldStart,
    jank,
    longTasks: longTaskReport,
    emptyCellTicks: pass.render ? emptyCellTicks : null,
    coldStartMs,
    coldStartCellResults,
  }
}

async function run(): Promise<void> {
  status(`warm-cold-mixed: M=${params.m} warm + ${params.coldCells} cold-start, ${params.passes.length} passes × ${params.runSeconds}s`)
  status(`recording source (${params.sourceSeconds}s)...`)
  const source = await recordProbeInput(
    params.captureResolution.width,
    params.captureResolution.height,
    params.sourceSeconds,
  )
  status(`  got ${source.width}x${source.height}, ${source.chunks.length} chunks`)

  status(`decoding source → ${params.cellMip.width}×${params.cellMip.height} raw RGBA...`)
  const rgbaStream = await decodeToRgba(source, params.cellMip.width, params.cellMip.height, params.framesPerCell)
  if (rgbaStream === null) {
    status(`  decode FAILED`)
    reportResult("warm-cold-mixed", params, { error: "rgba decode failed" })
    return
  }
  status(`  ${rgbaStream.frames.length} frames decoded`)

  status(`transcoding source → AV1 at ${rgbaStream.width}×${rgbaStream.height}...`)
  const av1Asset = await transcodeToAv1(source, params.cellMip.width, params.cellMip.height, params.framesPerCell)
  if (av1Asset === null) {
    status(`  AV1 transcode FAILED`)
    reportResult("warm-cold-mixed", params, { error: "av1 transcode failed" })
    return
  }
  status(`  AV1 ${av1Asset.chunks.length} chunks`)

  status(`writing OPFS files (${params.m} warm RGBA + ${params.coldCells} cold AV1)...`)
  const warmFileNames = await writeRgbaFiles(rgbaStream.frames, params.m, params.cellMip.label)
  const coldFileNames = await writeAv1Files(av1Asset, params.coldCells, params.cellMip.label)
  status(`  wrote ${warmFileNames.length} warm RGBA + ${coldFileNames.length} cold AV1`)
  rgbaStream.frames.length = 0
  av1Asset.chunks.length = 0

  const results: PassResult[] = []
  for (const pass of params.passes) {
    status(`PASS [${pass.label}] render=${pass.render} coldStart=${pass.coldStart}`)
    const result = await runPass(
      pass,
      warmFileNames,
      coldFileNames,
      av1Asset.config,
      av1Asset.width,
      av1Asset.height,
    )
    results.push(result)
    const fps = result.jank ? (result.jank.framesObserved / params.runSeconds).toFixed(1) : "n/a"
    const over33 = result.jank ? (result.jank.over33msRatio * 100).toFixed(1) + "%" : "n/a"
    const streak = result.jank?.longestJankStreak ?? "n/a"
    const cold = result.coldStartMs !== null ? `${result.coldStartMs.toFixed(0)}ms` : "n/a"
    const empty = result.emptyCellTicks ?? "n/a"
    const lt = result.longTasks?.observed ?? "n/a"
    status(`  fps=${fps} over33=${over33} streak=${streak} empty=${empty} coldStart=${cold} longtasks=${lt}`)
    await wait(2000)
  }

  await cleanupOpfs()
  status("done.")
  reportResult("warm-cold-mixed", params, { passes: results })
}

run().catch((error: unknown) => {
  status(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  reportResult("warm-cold-mixed", params, {
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  })
})
