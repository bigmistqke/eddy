// full-lifecycle — runs the C2 architecture's four phases in
// sequence at K=16: load (cold-start) → play 10s → record 5s (with
// playback continuing) → save (RGBA → AV1 parallel encode). Single
// pass; the integration test for everything we've measured in
// isolation.

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
  framesPerCell: 60,
  playSeconds: 10,
  recordSeconds: 5,
  bitratePerPixel: 0.1,
  sourceFps: 30,
  swCodec: { label: "av1", codecString: "av01.0.04M.08" },
  opfsDirName: "29",
  k: 16,
  gridCols: 4,
  gridRows: 4,
  cellMip: { label: "270p", width: 480, height: 272 },
}

const snap16 = (value: number): number => Math.max(16, Math.round(value / 16) * 16)

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

async function writeAv1Files(asset: Av1Asset, k: number): Promise<string[]> {
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
  for (let cellId = 0; cellId < k; cellId++) {
    const fileName = `cell-${cellId}-av1.bin`
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

interface ColdStartCellResult {
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
): Promise<ColdStartCellResult> {
  const worker = new Worker(
    new URL("../26b_cold-start-copyto-workers/warm-worker.ts", import.meta.url),
    { type: "module" },
  )
  const { promise, resolve } = Promise.withResolvers<ColdStartCellResult>()
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
      resolve(event.data)
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

interface ReaderHandle {
  worker: Worker
  ready: Promise<void>
  donePromise: Promise<void>
}

function spawnReader(
  fileNames: string[],
  mipWidth: number,
  mipHeight: number,
  onFrames: (frames: { cellId: number; bytes: Uint8Array }[]) => void,
): ReaderHandle {
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

interface EncodeCellResult {
  ok: boolean
  outputBytes: number
  encodeMs: number
  errors: string[]
}

async function encodeCellRgbaToAv1(
  rgbaFileName: string,
  width: number,
  height: number,
): Promise<EncodeCellResult> {
  const start = performance.now()
  const errors: string[] = []
  let outputBytes = 0
  const bitrate = Math.round(width * height * 30 * params.bitratePerPixel)
  const encoder = new VideoEncoder({
    output(chunk) {
      outputBytes += chunk.byteLength
    },
    error(error) {
      errors.push(`enc: ${error.message}`)
    },
  })
  try {
    encoder.configure({
      codec: params.swCodec.codecString,
      width,
      height,
      bitrate,
      framerate: 30,
    })
  } catch (error) {
    encoder.close()
    return {
      ok: false,
      outputBytes: 0,
      encodeMs: performance.now() - start,
      errors: [`configure: ${error instanceof Error ? error.message : String(error)}`],
    }
  }
  // Read RGBA bytes from OPFS.
  const root = await navigator.storage.getDirectory()
  const dir = await root.getDirectoryHandle(params.opfsDirName, { create: false })
  const fh = await dir.getFileHandle(rgbaFileName, { create: false })
  const file = await fh.getFile()
  const allBytes = new Uint8Array(await file.arrayBuffer())
  const frameSize = width * height * 4
  const frameCount = Math.floor(allBytes.byteLength / frameSize)
  for (let i = 0; i < frameCount; i++) {
    const slice = allBytes.slice(i * frameSize, (i + 1) * frameSize)
    const frame = new VideoFrame(slice, {
      format: "RGBA",
      codedWidth: width,
      codedHeight: height,
      timestamp: i * 33333,
    })
    try {
      encoder.encode(frame, { keyFrame: i === 0 })
    } catch (error) {
      errors.push(`encode: ${error instanceof Error ? error.message : String(error)}`)
    }
    frame.close()
  }
  try {
    await encoder.flush()
  } catch (error) {
    errors.push(`flush: ${error instanceof Error ? error.message : String(error)}`)
  }
  encoder.close()
  return {
    ok: errors.length === 0,
    outputBytes,
    encodeMs: performance.now() - start,
    errors,
  }
}

interface LifecycleResult {
  load: {
    coldStartMs: number
    perCell: ColdStartCellResult[]
  }
  play: {
    jank: JankReport
    longTasks: LongTaskReport
    emptyCellTicks: number
  }
  record: {
    jank: JankReport
    longTasks: LongTaskReport
    emptyCellTicks: number
    captureCompleted: boolean
    captureChunks: number | null
  }
  save: {
    saveMs: number
    perCell: EncodeCellResult[]
    totalKb: number
    avgBytesPerCell: number
  }
  totalMs: number
}

async function run(): Promise<void> {
  status(`full-lifecycle: K=${params.k} mip=${params.cellMip.label}`)

  status(`setup: recording VP8 source (${params.sourceSeconds}s)...`)
  const source = await recordProbeInput(
    params.captureResolution.width,
    params.captureResolution.height,
    params.sourceSeconds,
  )
  status(`  got ${source.width}x${source.height}, ${source.chunks.length} chunks`)

  status(`setup: transcoding source → AV1 ${params.cellMip.width}×${params.cellMip.height}...`)
  const av1Asset = await transcodeToAv1(
    source,
    params.cellMip.width,
    params.cellMip.height,
    params.framesPerCell,
  )
  if (av1Asset === null) {
    status(`  transcode FAILED`)
    reportResult("full-lifecycle", params, { error: "transcode failed" })
    return
  }
  status(`  AV1: ${av1Asset.chunks.length} chunks, ${(av1Asset.chunks.reduce((s, c) => s + c.byteLength, 0) / 1024).toFixed(0)} KB per cell`)

  status(`setup: writing K=${params.k} AV1 files to OPFS...`)
  const av1FileNames = await writeAv1Files(av1Asset, params.k)
  status(`  wrote ${av1FileNames.length} files`)

  const totalStart = performance.now()

  // PHASE 1 — LOAD (cold-start).
  status(`PHASE 1 — LOAD: cold-start K=${params.k} parallel workers...`)
  const loadStart = performance.now()
  const coldStartResults = await Promise.all(
    av1FileNames.map((fn, i) =>
      spawnWarmWorker(
        i,
        fn,
        fn.replace("-av1.bin", "-rgba.bin"),
        av1Asset.config,
        av1Asset.width,
        av1Asset.height,
      ),
    ),
  )
  const loadMs = performance.now() - loadStart
  status(`  load completed in ${loadMs.toFixed(0)}ms`)

  const rgbaFileNames = av1FileNames.map(fn => fn.replace("-av1.bin", "-rgba.bin"))

  // GL setup for play + record.
  const canvas = document.createElement("canvas")
  canvas.width = window.innerWidth * (window.devicePixelRatio || 1)
  canvas.height = window.innerHeight * (window.devicePixelRatio || 1)
  canvas.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;z-index:0;display:block"
  document.body.appendChild(canvas)
  const glOrNull = canvas.getContext("webgl2")
  if (glOrNull === null) {
    document.body.removeChild(canvas)
    reportResult("full-lifecycle", params, { error: "no webgl2" })
    return
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
  for (let i = 0; i < params.k; i++) {
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    textures.push(tex)
  }

  // Spawn reader worker for the RGBA cells.
  const latestBytes: Map<number, Uint8Array> = new Map()
  const readerHandle = spawnReader(rgbaFileNames, av1Asset.width, av1Asset.height, frames => {
    for (const { cellId, bytes } of frames) {
      latestBytes.set(cellId, bytes)
    }
  })
  await readerHandle.ready
  // Wait for initial frames.
  const initDeadline = performance.now() + 500
  while (performance.now() < initDeadline && latestBytes.size < params.k) {
    await wait(10)
  }

  const viewportCellW = 2 / params.gridCols
  const viewportCellH = 2 / params.gridRows
  let phaseEmptyTicks = 0

  function renderTick(now: number): void {
    gl.clear(gl.COLOR_BUFFER_BIT)
    for (let i = 0; i < params.k; i++) {
      const bytes = latestBytes.get(i)
      if (bytes === undefined) {
        phaseEmptyTicks++
        continue
      }
      gl.bindTexture(gl.TEXTURE_2D, textures[i])
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        av1Asset.width,
        av1Asset.height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        bytes,
      )
      const row = Math.floor(i / params.gridCols)
      const col = i % params.gridCols
      gl.uniform2f(uNdcOffset, -1 + col * viewportCellW, 1 - (row + 1) * viewportCellH)
      gl.uniform2f(uNdcScale, viewportCellW, viewportCellH)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    }
  }

  // PHASE 2 — PLAY.
  status(`PHASE 2 — PLAY: rendering K=${params.k} cells for ${params.playSeconds}s...`)
  const playRecorder = new JankRecorder()
  const playLongTasks = observeLongTasks()
  phaseEmptyTicks = 0
  const playDeadline = performance.now() + params.playSeconds * 1000
  await new Promise<void>(resolveLoop => {
    function tick(now: number): void {
      if (now >= playDeadline) {
        resolveLoop()
        return
      }
      playRecorder.mark(now)
      renderTick(now)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const playJank = playRecorder.snapshot()
  const playLt = playLongTasks.stop()
  const playEmpty = phaseEmptyTicks
  status(
    `  play: fps=${(playJank.framesObserved / params.playSeconds).toFixed(1)} ` +
      `over33=${(playJank.over33msRatio * 100).toFixed(1)}% empty=${playEmpty}`,
  )

  // PHASE 3 — RECORD.
  status(`PHASE 3 — RECORD: continuing render + ${params.recordSeconds}s camera capture...`)
  let captureCompleted = false
  let captureChunks: number | null = null
  const capturePromise = recordProbeInput(
    params.captureResolution.width,
    params.captureResolution.height,
    params.recordSeconds,
  )
    .then(probe => {
      captureCompleted = true
      captureChunks = probe.chunks.length
    })
    .catch(() => {
      captureCompleted = false
    })
  const recordRecorder = new JankRecorder()
  const recordLongTasks = observeLongTasks()
  phaseEmptyTicks = 0
  const recordDeadline = performance.now() + params.recordSeconds * 1000
  await new Promise<void>(resolveLoop => {
    function tick(now: number): void {
      if (now >= recordDeadline) {
        resolveLoop()
        return
      }
      recordRecorder.mark(now)
      renderTick(now)
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  const recordJank = recordRecorder.snapshot()
  const recordLt = recordLongTasks.stop()
  const recordEmpty = phaseEmptyTicks
  await Promise.race([capturePromise, wait(3000)])
  status(
    `  record: fps=${(recordJank.framesObserved / params.recordSeconds).toFixed(1)} ` +
      `over33=${(recordJank.over33msRatio * 100).toFixed(1)}% empty=${recordEmpty} ` +
      `capture=${captureCompleted ? captureChunks + " chunks" : "failed"}`,
  )

  // Tear down render.
  for (const tex of textures) {
    gl.deleteTexture(tex)
  }
  gl.deleteBuffer(buffer)
  gl.deleteProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  document.body.removeChild(canvas)
  readerHandle.worker.postMessage({ type: "stop" })
  await Promise.race([readerHandle.donePromise, wait(2000)])
  readerHandle.worker.terminate()

  // PHASE 4 — SAVE.
  status(`PHASE 4 — SAVE: parallel encode K=${params.k} RGBA → AV1...`)
  const saveStart = performance.now()
  const encodeResults = await Promise.all(
    rgbaFileNames.map(fn => encodeCellRgbaToAv1(fn, av1Asset.width, av1Asset.height)),
  )
  const saveMs = performance.now() - saveStart
  const totalBytes = encodeResults.reduce((s, r) => s + r.outputBytes, 0)
  const avgBytes = totalBytes / encodeResults.length
  status(
    `  save: ${saveMs.toFixed(0)}ms total, ${(totalBytes / 1024).toFixed(0)} KB total, ${(avgBytes / 1024).toFixed(1)} KB/cell`,
  )

  const totalMs = performance.now() - totalStart

  const result: LifecycleResult = {
    load: { coldStartMs: loadMs, perCell: coldStartResults },
    play: { jank: playJank, longTasks: playLt, emptyCellTicks: playEmpty },
    record: {
      jank: recordJank,
      longTasks: recordLt,
      emptyCellTicks: recordEmpty,
      captureCompleted,
      captureChunks,
    },
    save: { saveMs, perCell: encodeResults, totalKb: totalBytes / 1024, avgBytesPerCell: avgBytes },
    totalMs,
  }

  await cleanupOpfs()
  status(`done. total wall=${totalMs.toFixed(0)}ms`)
  reportResult("full-lifecycle", params, result)
}

run().catch((error: unknown) => {
  status(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  reportResult("full-lifecycle", params, {
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  })
})
