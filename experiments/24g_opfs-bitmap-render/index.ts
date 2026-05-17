// opfs-bitmap-render — 24f's all-bitmap render loop, but bytes are
// stored in OPFS (one file per cell) and streamed in via a reader
// worker. Validates the production-shape data pipeline at K=4-25.

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
  runSeconds: 10,
  framesPerPass: 60,
  sourceFps: 30,
  opfsDirName: "24g",
  passes: [
    { k: 4, gridCols: 2, gridRows: 2, mip: { label: "540p", width: 960, height: 544 } },
    { k: 9, gridCols: 3, gridRows: 3, mip: { label: "360p", width: 640, height: 368 } },
    { k: 16, gridCols: 4, gridRows: 4, mip: { label: "270p", width: 480, height: 272 } },
    { k: 25, gridCols: 5, gridRows: 5, mip: { label: "180p", width: 320, height: 184 } },
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

async function writeBitmapFilesToOpfs(
  frames: Uint8Array[],
  k: number,
  mipLabel: string,
): Promise<{ fileNames: string[]; writeMs: number; totalBytes: number }> {
  const start = performance.now()
  const root = await navigator.storage.getDirectory()
  const dir = await root.getDirectoryHandle(params.opfsDirName, { create: true })
  const fileNames: string[] = []
  let totalBytes = 0
  for (let cellId = 0; cellId < k; cellId++) {
    const fileName = `${mipLabel}-cell-${cellId}.bin`
    const fileHandle = await dir.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable({ keepExistingData: false })
    for (const frame of frames) {
      await writable.write(frame)
      totalBytes += frame.byteLength
    }
    await writable.close()
    fileNames.push(fileName)
  }
  return {
    fileNames,
    writeMs: performance.now() - start,
    totalBytes,
  }
}

async function cleanupOpfsFiles(fileNames: string[]): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(params.opfsDirName, { create: false })
    for (const fileName of fileNames) {
      try {
        await dir.removeEntry(fileName)
      } catch {}
    }
  } catch {}
}

interface PassResult {
  k: number
  mip: string
  mipWidth: number
  mipHeight: number
  frameCount: number
  opfsBytesMb: number
  opfsWriteMs: number
  framesDelivered: Record<number, number>
  emptyCellTicks: number
  jank: JankReport
  longTasks: LongTaskReport
}

interface WorkerHandle {
  worker: Worker
  framesDelivered: Record<number, number>
  donePromise: Promise<void>
  resolveDone: () => void
  resolveReady: () => void
  ready: Promise<void>
}

function createReaderWorker(
  onFrames: (frames: { cellId: number; bytes: Uint8Array }[]) => void,
): WorkerHandle {
  const worker = new Worker(
    new URL("./bitmap-reader-worker.ts", import.meta.url),
    { type: "module" },
  )
  const { promise: ready, resolve: resolveReady } = Promise.withResolvers<void>()
  const { promise: donePromise, resolve: resolveDone } = Promise.withResolvers<void>()
  const handle: WorkerHandle = {
    worker,
    framesDelivered: {},
    donePromise,
    resolveDone,
    resolveReady,
    ready,
  }
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
      handle.framesDelivered = msg.framesDelivered
      resolveDone()
      return
    }
  }
  return handle
}

async function runRenderLoop(
  pass: (typeof params.passes)[number],
  mipWidth: number,
  mipHeight: number,
  fileNames: string[],
): Promise<{ jank: JankReport; longTasks: LongTaskReport; emptyCellTicks: number; framesDelivered: Record<number, number> }> {
  const latestBytes: Map<number, Uint8Array> = new Map()
  const handle = createReaderWorker(frames => {
    for (const { cellId, bytes } of frames) {
      latestBytes.set(cellId, bytes)
    }
  })

  const cellInit = fileNames.map((fileName, cellId) => ({
    cellId,
    fileName,
    frameSize: mipWidth * mipHeight * 4,
    totalFrames: params.framesPerPass,
  }))
  handle.worker.postMessage({
    type: "init",
    dirName: params.opfsDirName,
    cells: cellInit,
    sourceFps: params.sourceFps,
  })
  await handle.ready

  // Wait briefly for initial frames to arrive.
  const waitDeadline = performance.now() + 500
  while (performance.now() < waitDeadline && latestBytes.size < pass.k) {
    await wait(10)
  }

  const canvas = document.createElement("canvas")
  canvas.width = window.innerWidth * (window.devicePixelRatio || 1)
  canvas.height = window.innerHeight * (window.devicePixelRatio || 1)
  canvas.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;z-index:0;display:block"
  document.body.appendChild(canvas)
  const glOrNull = canvas.getContext("webgl2")
  if (glOrNull === null) {
    document.body.removeChild(canvas)
    handle.worker.postMessage({ type: "stop" })
    handle.worker.terminate()
    throw new Error("runRenderLoop: no webgl2 context")
  }
  const gl = glOrNull

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
  const uNdcOffset = gl.getUniformLocation(program, "uNdcOffset")
  const uNdcScale = gl.getUniformLocation(program, "uNdcScale")
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)

  const textures: WebGLTexture[] = []
  for (let i = 0; i < pass.k; i++) {
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    textures.push(tex)
  }

  const recorder = new JankRecorder()
  const longTasks = observeLongTasks()
  const deadline = performance.now() + params.runSeconds * 1000
  const viewportCellW = 2 / pass.gridCols
  const viewportCellH = 2 / pass.gridRows
  let emptyCellTicks = 0

  await new Promise<void>(resolveLoop => {
    function tick(now: number) {
      if (now >= deadline) {
        resolveLoop()
        return
      }
      recorder.mark(now)
      gl.clear(gl.COLOR_BUFFER_BIT)
      for (let i = 0; i < pass.k; i++) {
        const bytes = latestBytes.get(i)
        if (bytes === undefined) {
          emptyCellTicks++
          continue
        }
        gl.bindTexture(gl.TEXTURE_2D, textures[i])
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          mipWidth,
          mipHeight,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          bytes,
        )
        const row = Math.floor(i / pass.gridCols)
        const col = i % pass.gridCols
        gl.uniform2f(uNdcOffset, -1 + col * viewportCellW, 1 - (row + 1) * viewportCellH)
        gl.uniform2f(uNdcScale, viewportCellW, viewportCellH)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  const longTaskReport = longTasks.stop()
  const jank = recorder.snapshot()

  for (const tex of textures) {
    gl.deleteTexture(tex)
  }
  gl.deleteBuffer(buffer)
  gl.deleteProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  document.body.removeChild(canvas)

  // Stop worker, wait for done message, terminate.
  handle.worker.postMessage({ type: "stop" })
  await Promise.race([handle.donePromise, wait(2000)])
  handle.worker.terminate()

  return {
    jank,
    longTasks: longTaskReport,
    emptyCellTicks,
    framesDelivered: handle.framesDelivered,
  }
}

async function run(): Promise<void> {
  status(`opfs-bitmap-render: ${params.passes.length} K-values × ${params.runSeconds}s`)
  status(`recording source clip (${params.sourceSeconds}s)...`)
  const source = await recordProbeInput(
    params.captureResolution.width,
    params.captureResolution.height,
    params.sourceSeconds,
  )
  status(`  got ${source.width}x${source.height}, ${source.chunks.length} chunks`)

  const results: PassResult[] = []
  for (const pass of params.passes) {
    status(`PASS K=${pass.k} grid=${pass.gridCols}×${pass.gridRows} mip=${pass.mip.label}`)
    status(`  decoding source → ${pass.mip.width}×${pass.mip.height} raw RGBA...`)
    const stream = await decodeToRgba(
      source,
      pass.mip.width,
      pass.mip.height,
      params.framesPerPass,
    )
    if (stream === null) {
      status(`  decode FAILED — skipping`)
      continue
    }
    status(`  ${stream.frames.length} frames decoded; writing K=${pass.k} OPFS files...`)
    const writeResult = await writeBitmapFilesToOpfs(stream.frames, pass.k, pass.mip.label)
    status(
      `  wrote ${writeResult.fileNames.length} files, ${(writeResult.totalBytes / 1024 / 1024).toFixed(1)} MB total in ${writeResult.writeMs.toFixed(0)}ms`,
    )
    // Free in-memory frames before running render loop.
    stream.frames.length = 0

    const result = await runRenderLoop(pass, stream.width, stream.height, writeResult.fileNames)
    results.push({
      k: pass.k,
      mip: pass.mip.label,
      mipWidth: stream.width,
      mipHeight: stream.height,
      frameCount: params.framesPerPass,
      opfsBytesMb: writeResult.totalBytes / 1024 / 1024,
      opfsWriteMs: writeResult.writeMs,
      framesDelivered: result.framesDelivered,
      emptyCellTicks: result.emptyCellTicks,
      jank: result.jank,
      longTasks: result.longTasks,
    })
    const minDelivered = Math.min(
      ...Object.values(result.framesDelivered).map(v => v as number),
      Number.MAX_SAFE_INTEGER,
    )
    const maxDelivered = Math.max(
      ...Object.values(result.framesDelivered).map(v => v as number),
      0,
    )
    status(
      `  fps=${(result.jank.framesObserved / params.runSeconds).toFixed(1)} ` +
        `mean=${result.jank.meanMs.toFixed(1)}ms p95=${result.jank.p95Ms.toFixed(1)}ms ` +
        `over33=${(result.jank.over33msRatio * 100).toFixed(1)}% ` +
        `streak=${result.jank.longestJankStreak} score=${result.jank.jankScore.toFixed(1)} ` +
        `delivered=${minDelivered}-${maxDelivered}/cell empty=${result.emptyCellTicks} ` +
        `longtasks=${result.longTasks.observed}`,
    )

    await cleanupOpfsFiles(writeResult.fileNames)
  }
  status("done.")
  reportResult("opfs-bitmap-render", params, { passes: results })
}

run().catch((error: unknown) => {
  status(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  reportResult("opfs-bitmap-render", params, {
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  })
})
