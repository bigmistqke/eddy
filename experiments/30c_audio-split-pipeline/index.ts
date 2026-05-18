// audio-split-pipeline — adds live audio capture to 30g's dual video
// encode (720p + 270p via WebGL resize). Audio is captured once from
// getUserMedia, the audio track is cloned twice, and each clone feeds
// a mediabunny MediaStreamAudioTrackSource on its respective Output.
// K=9 270p decoder workers run in the background to keep the SoC
// under realistic concurrent load.

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedPacketSink,
  Input,
  MediaStreamAudioTrackSource,
  Output,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
} from "mediabunny"
import { wait } from "../../src/utils"
import { reportResult, status } from "../harness/report"

const params = {
  highResolution: { width: 1280, height: 720 },
  lowResolution: { width: 480, height: 272 },
  encodeSeconds: 10,
  targetFps: 30,
  bitratePerPixel: 0.1,
  videoCodec: "av1" as const,
  audioCodec: "opus" as const,
  audioBitrate: 96_000,
  fixtureSeconds: 6,
  warmupMs: 1000,
  K: 9,
}

interface WorkerHandle {
  worker: Worker
  poll(): Promise<number>
  stop(): void
}

interface ChunkInit {
  type: "key" | "delta"
  timestamp: number
  duration: number | null
  data: ArrayBuffer
}

interface EncoderStats {
  framesSubmitted: number
  framesEncoded: number
  encodedFps: number
  pendingAddsMax: number
  addP95Ms: number
  addMaxMs: number
  finalizeMs: number
}

interface OutputStats {
  webmBytes: number
  tracksOk: boolean
  videoPacketCount: number
  audioPacketCount: number
  lastVideoEndUs: number
  lastAudioEndUs: number
  avDriftMs: number
}

interface RunResult {
  high: EncoderStats & OutputStats
  low: EncoderStats & OutputStats
  resizeP95Ms: number
  tickLagP95Ms: number
  decoderFps: number[]
  decoderFpsMin: number
  decoderFpsMean: number
  audioErrors: string[]
  errors: string[]
}

interface ResizeRig {
  canvas: OffscreenCanvas
  gl: WebGL2RenderingContext
  texture: WebGLTexture
}

function setupResizeRig(width: number, height: number): ResizeRig {
  const canvas = new OffscreenCanvas(width, height)
  const glOrNull = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true })
  if (glOrNull === null) {
    throw new Error("setupResizeRig: WebGL2 unavailable")
  }
  const gl: WebGL2RenderingContext = glOrNull
  const vsSource = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2((a_pos.x + 1.0) * 0.5, (1.0 - a_pos.y) * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`
  const fsSource = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 outColor;
void main() {
  outColor = texture(u_tex, v_uv);
}
`
  function compile(type: number, source: string): WebGLShader {
    const shader = gl.createShader(type)
    if (shader === null) {
      throw new Error("compile: createShader")
    }
    gl.shaderSource(shader, source)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(`compile: ${gl.getShaderInfoLog(shader) ?? ""}`)
    }
    return shader
  }
  const vs = compile(gl.VERTEX_SHADER, vsSource)
  const fs = compile(gl.FRAGMENT_SHADER, fsSource)
  const program = gl.createProgram()
  if (program === null) {
    throw new Error("setupResizeRig: createProgram")
  }
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`setupResizeRig: link ${gl.getProgramInfoLog(program) ?? ""}`)
  }
  gl.useProgram(program)
  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(program, "a_pos")
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)
  const texture = gl.createTexture()
  if (texture === null) {
    throw new Error("setupResizeRig: createTexture")
  }
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.viewport(0, 0, width, height)
  return { canvas, gl, texture }
}

function resizeWithWebgl(rig: ResizeRig, source: VideoFrame, timestampUs: number): VideoFrame {
  rig.gl.bindTexture(rig.gl.TEXTURE_2D, rig.texture)
  rig.gl.texImage2D(
    rig.gl.TEXTURE_2D,
    0,
    rig.gl.RGBA,
    rig.gl.RGBA,
    rig.gl.UNSIGNED_BYTE,
    source,
  )
  rig.gl.drawArrays(rig.gl.TRIANGLE_STRIP, 0, 4)
  rig.gl.finish()
  const bitmap = rig.canvas.transferToImageBitmap()
  const out = new VideoFrame(bitmap, { timestamp: timestampUs })
  bitmap.close()
  return out
}

interface VideoRig {
  output: Output
  videoSource: VideoSampleSource
  audioSource: MediaStreamAudioTrackSource
  stats: {
    framesSubmitted: number
    framesEncoded: number
    pendingAdds: number
    pendingAddsMax: number
    addTimings: number[]
    errors: string[]
  }
}

async function makeRig(
  width: number,
  height: number,
  audioTrack: MediaStreamAudioTrack,
): Promise<VideoRig> {
  const output = new Output({
    format: new WebMOutputFormat(),
    target: new BufferTarget(),
  })
  const bitrate = Math.round(
    width * height * params.targetFps * params.bitratePerPixel,
  )
  const videoSource = new VideoSampleSource({ codec: params.videoCodec, bitrate })
  output.addVideoTrack(videoSource)
  const audioSource = new MediaStreamAudioTrackSource(audioTrack, {
    codec: params.audioCodec,
    bitrate: params.audioBitrate,
  })
  output.addAudioTrack(audioSource)
  await output.start()
  return {
    output,
    videoSource,
    audioSource,
    stats: {
      framesSubmitted: 0,
      framesEncoded: 0,
      pendingAdds: 0,
      pendingAddsMax: 0,
      addTimings: [],
      errors: [],
    },
  }
}

function submitVideo(rig: VideoRig, sample: VideoSample): void {
  rig.stats.framesSubmitted++
  rig.stats.pendingAdds++
  if (rig.stats.pendingAdds > rig.stats.pendingAddsMax) {
    rig.stats.pendingAddsMax = rig.stats.pendingAdds
  }
  const addStart = performance.now()
  rig.videoSource
    .add(sample)
    .then(() => {
      rig.stats.addTimings.push(performance.now() - addStart)
      rig.stats.framesEncoded++
    })
    .catch((error: unknown) => {
      rig.stats.errors.push(error instanceof Error ? error.message : String(error))
    })
    .finally(() => {
      rig.stats.pendingAdds--
      sample.close()
    })
}

async function finalizeRig(rig: VideoRig): Promise<EncoderStats & OutputStats> {
  const drainStart = performance.now()
  while (rig.stats.pendingAdds > 0) {
    await wait(10)
    if (performance.now() - drainStart > 60_000) {
      rig.stats.errors.push(`drain: still ${rig.stats.pendingAdds} pending`)
      break
    }
  }
  const finalizeStart = performance.now()
  rig.videoSource.close()
  rig.audioSource.close?.()
  await rig.output.finalize()
  const finalizeMs = performance.now() - finalizeStart

  const buffer = (rig.output.target as BufferTarget).buffer
  const webmBytes = buffer === null ? 0 : buffer.byteLength
  let tracksOk = false
  let videoPacketCount = 0
  let audioPacketCount = 0
  let lastVideoEndUs = 0
  let lastAudioEndUs = 0
  if (buffer !== null) {
    try {
      const blob = new Blob([buffer], { type: "video/webm" })
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) })
      const videoTracks = await input.getVideoTracks()
      const audioTracks = await input.getAudioTracks()
      tracksOk = videoTracks.length > 0 && audioTracks.length > 0
      const videoTrack = videoTracks[0] ?? null
      if (videoTrack !== null) {
        const sink = new EncodedPacketSink(videoTrack)
        for await (const packet of sink.packets()) {
          videoPacketCount++
          lastVideoEndUs = (packet.timestamp ?? 0) + (packet.duration ?? 0)
        }
      }
      const audioTrack = audioTracks[0] ?? null
      if (audioTrack !== null) {
        const sink = new EncodedPacketSink(audioTrack)
        for await (const packet of sink.packets()) {
          audioPacketCount++
          lastAudioEndUs = (packet.timestamp ?? 0) + (packet.duration ?? 0)
        }
      }
    } catch (error) {
      rig.stats.errors.push(
        `roundtrip: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  const sortedAdd = rig.stats.addTimings.slice().sort((a, b) => a - b)
  const p95Idx = Math.min(sortedAdd.length - 1, Math.floor(sortedAdd.length * 0.95))
  return {
    framesSubmitted: rig.stats.framesSubmitted,
    framesEncoded: rig.stats.framesEncoded,
    encodedFps: rig.stats.framesEncoded / params.encodeSeconds,
    pendingAddsMax: rig.stats.pendingAddsMax,
    addP95Ms: sortedAdd.length > 0 ? sortedAdd[p95Idx] : 0,
    addMaxMs: sortedAdd.length > 0 ? sortedAdd[sortedAdd.length - 1] : 0,
    finalizeMs,
    webmBytes,
    tracksOk,
    videoPacketCount,
    audioPacketCount,
    lastVideoEndUs,
    lastAudioEndUs,
    // EncodedPacket.timestamp is in seconds (per mediabunny docs); the
    // variable names `…EndUs` here are historical — they hold seconds.
    avDriftMs: Math.abs(lastVideoEndUs - lastAudioEndUs) * 1000,
  }
}

// Fixture for decoder workers — 270p AV1 like 30g.
async function buildFixture(): Promise<{
  chunkInits: ChunkInit[]
  config: VideoDecoderConfig
}> {
  status(
    `fixture: encoding ${params.fixtureSeconds}s ${params.lowResolution.width}×${params.lowResolution.height} @ ${params.targetFps}fps…`,
  )
  const canvas = new OffscreenCanvas(
    params.lowResolution.width,
    params.lowResolution.height,
  )
  const ctx = canvas.getContext("2d")
  if (ctx === null) {
    throw new Error("buildFixture: no 2d context")
  }
  const output = new Output({
    format: new WebMOutputFormat(),
    target: new BufferTarget(),
  })
  const bitrate = Math.round(
    params.lowResolution.width *
      params.lowResolution.height *
      params.targetFps *
      params.bitratePerPixel,
  )
  const videoSource = new VideoSampleSource({ codec: params.videoCodec, bitrate })
  output.addVideoTrack(videoSource)
  await output.start()
  for (let i = 0; i < params.fixtureSeconds * params.targetFps; i++) {
    ctx.fillStyle = `hsl(${(i * 6) % 360}, 80%, 50%)`
    ctx.fillRect(0, 0, params.lowResolution.width, params.lowResolution.height)
    const timestampUs = Math.round((i / params.targetFps) * 1_000_000)
    const frame = new VideoFrame(canvas, { timestamp: timestampUs })
    const sample = new VideoSample(frame)
    await videoSource.add(sample)
    sample.close()
    frame.close()
  }
  videoSource.close()
  await output.finalize()
  const buffer = (output.target as BufferTarget).buffer
  if (buffer === null) {
    throw new Error("buildFixture: no buffer")
  }
  const blob = new Blob([buffer], { type: "video/webm" })
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) })
  const track = await input.getPrimaryVideoTrack()
  if (track === null) {
    throw new Error("buildFixture: no track")
  }
  const config = await track.getDecoderConfig()
  if (config === null) {
    throw new Error("buildFixture: no decoder config")
  }
  const sink = new EncodedPacketSink(track)
  const chunkInits: ChunkInit[] = []
  for await (const packet of sink.packets()) {
    const chunk = packet.toEncodedVideoChunk()
    const data = new ArrayBuffer(chunk.byteLength)
    chunk.copyTo(data)
    chunkInits.push({
      type: chunk.type,
      timestamp: chunk.timestamp,
      duration: chunk.duration,
      data,
    })
  }
  return { chunkInits, config }
}

async function spawnDecoderWorker(
  chunkInits: ChunkInit[],
  config: VideoDecoderConfig,
): Promise<WorkerHandle> {
  const worker = new Worker(new URL("./decoder-worker.ts", import.meta.url), {
    type: "module",
  })
  const { promise: ready, resolve: resolveReady } = Promise.withResolvers<void>()
  worker.onmessage = (event: MessageEvent<{ type: string }>) => {
    if (event.data.type === "ready") {
      resolveReady()
    }
  }
  const clonedChunks: ChunkInit[] = chunkInits.map(c => ({
    type: c.type,
    timestamp: c.timestamp,
    duration: c.duration,
    data: c.data.slice(0),
  }))
  worker.postMessage({
    type: "init",
    chunks: clonedChunks,
    config,
    copyWidth: params.lowResolution.width,
    copyHeight: params.lowResolution.height,
    targetFps: params.targetFps,
  })
  await ready
  return {
    worker,
    async poll(): Promise<number> {
      const { promise, resolve } = Promise.withResolvers<number>()
      const onMessage = (event: MessageEvent<{ type: string; framesDecoded?: number }>): void => {
        if (event.data.type === "poll-response") {
          worker.removeEventListener("message", onMessage)
          resolve(event.data.framesDecoded ?? 0)
        }
      }
      worker.addEventListener("message", onMessage)
      worker.postMessage({ type: "poll" })
      return promise
    },
    stop(): void {
      worker.postMessage({ type: "stop" })
      setTimeout(() => {
        worker.terminate()
      }, 50)
    },
  }
}

async function run(): Promise<void> {
  status(
    `audio-split-pipeline: K=${params.K}, dual encode ${params.highResolution.width}×${params.highResolution.height} + ${params.lowResolution.width}×${params.lowResolution.height} + opus audio, ${params.encodeSeconds}s @ ${params.targetFps}fps`,
  )
  status("opening camera + microphone…")
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: params.highResolution.width,
      height: params.highResolution.height,
    },
    audio: true,
  })
  const [videoTrack] = stream.getVideoTracks()
  const [audioTrack] = stream.getAudioTracks()
  if (videoTrack === undefined || audioTrack === undefined) {
    throw new Error("run: missing video or audio track")
  }
  const videoSettings = videoTrack.getSettings()
  const audioSettings = audioTrack.getSettings()
  status(
    `  camera ${videoSettings.width}×${videoSettings.height} @ ${videoSettings.frameRate ?? "?"}fps`,
  )
  status(`  audio ${audioSettings.sampleRate ?? "?"}Hz / ${audioSettings.channelCount ?? "?"}ch`)

  const fixture = await buildFixture()
  status(`fixture: ${fixture.chunkInits.length} chunks`)

  const workers: WorkerHandle[] = []
  for (let i = 0; i < params.K; i++) {
    workers.push(await spawnDecoderWorker(fixture.chunkInits, fixture.config))
  }
  await wait(params.warmupMs)
  status(`warmup done, capturing…`)
  const decoderBaselines = await Promise.all(workers.map(w => w.poll()))

  // Clone the audio track so each Output's MediaStreamAudioTrackSource
  // owns its own track instance.
  const audioTrackHigh = audioTrack.clone()
  const audioTrackLow = audioTrack.clone()
  const errors: string[] = []
  const audioErrors: string[] = []
  const rigHigh = await makeRig(
    params.highResolution.width,
    params.highResolution.height,
    audioTrackHigh,
  )
  const rigLow = await makeRig(
    params.lowResolution.width,
    params.lowResolution.height,
    audioTrackLow,
  )
  rigHigh.audioSource.errorPromise.catch((error: unknown) => {
    audioErrors.push(`high: ${error instanceof Error ? error.message : String(error)}`)
  })
  rigLow.audioSource.errorPromise.catch((error: unknown) => {
    audioErrors.push(`low: ${error instanceof Error ? error.message : String(error)}`)
  })

  const resizeRig = setupResizeRig(
    params.lowResolution.width,
    params.lowResolution.height,
  )

  const processorCtor = (window as unknown as {
    MediaStreamTrackProcessor: new (init: { track: MediaStreamTrack }) => {
      readable: ReadableStream<VideoFrame>
    }
  }).MediaStreamTrackProcessor
  const videoProcessor = new processorCtor({ track: videoTrack })
  const videoReader = videoProcessor.readable.getReader()

  const startMs = performance.now()
  const deadlineMs = startMs + params.encodeSeconds * 1000
  const tickLags: number[] = []
  const resizeTimings: number[] = []
  let framesPulled = 0
  let firstCameraTimestampUs: number | null = null

  // Pull camera frames; for each, feed both video encoders. Audio is
  // driven internally by mediabunny's MediaStreamAudioTrackSource — we
  // don't need to pump it.
  //
  // IMPORTANT: rebase video timestamps to start at 0 (sync with
  // audio source's 'synced-zero' base). Camera VideoFrame.timestamp
  // is in microseconds from an arbitrary system-clock origin; if
  // passed through verbatim, the muxed video track will have huge
  // timestamps relative to audio's zero-based ones, breaking A/V
  // alignment on playback.
  while (performance.now() < deadlineMs) {
    const { value, done } = await videoReader.read()
    if (done) {
      break
    }
    framesPulled++
    if (firstCameraTimestampUs === null) {
      firstCameraTimestampUs = value.timestamp
    }
    const timestampUs = value.timestamp - firstCameraTimestampUs
    tickLags.push(0)

    try {
      // Re-stamp the high-res frame to the rebased timestamp.
      const highRebased = new VideoFrame(value, { timestamp: timestampUs })
      const highSample = new VideoSample(highRebased)
      submitVideo(rigHigh, highSample)
    } catch (error) {
      errors.push(`high submit: ${error instanceof Error ? error.message : String(error)}`)
    }
    const resizeStart = performance.now()
    try {
      const lowFrame = resizeWithWebgl(resizeRig, value, timestampUs)
      resizeTimings.push(performance.now() - resizeStart)
      const lowSample = new VideoSample(lowFrame)
      submitVideo(rigLow, lowSample)
    } catch (error) {
      errors.push(`resize/low: ${error instanceof Error ? error.message : String(error)}`)
    }
    value.close()
  }

  try {
    videoReader.releaseLock()
  } catch {}
  try {
    videoTrack.stop()
  } catch {}
  try {
    audioTrackHigh.stop()
  } catch {}
  try {
    audioTrackLow.stop()
  } catch {}
  try {
    audioTrack.stop()
  } catch {}

  status(`captured ${framesPulled} video frames; finalizing…`)
  const decoderFinals = await Promise.all(workers.map(w => w.poll()))
  for (const w of workers) {
    w.stop()
  }
  const [statsHigh, statsLow] = await Promise.all([finalizeRig(rigHigh), finalizeRig(rigLow)])

  const decoderFps = decoderFinals.map(
    (f, i) => (f - decoderBaselines[i]) / params.encodeSeconds,
  )
  const decoderFpsMin = decoderFps.length === 0 ? 0 : Math.min(...decoderFps)
  const decoderFpsMean =
    decoderFps.length === 0 ? 0 : decoderFps.reduce((a, b) => a + b, 0) / decoderFps.length
  const sortedResize = resizeTimings.slice().sort((a, b) => a - b)
  const p95RIdx = Math.min(sortedResize.length - 1, Math.floor(sortedResize.length * 0.95))
  const sortedLag = tickLags.slice().sort((a, b) => a - b)
  const p95LIdx = Math.min(sortedLag.length - 1, Math.floor(sortedLag.length * 0.95))

  const result: RunResult = {
    high: statsHigh,
    low: statsLow,
    resizeP95Ms: sortedResize.length > 0 ? sortedResize[p95RIdx] : 0,
    tickLagP95Ms: sortedLag.length > 0 ? sortedLag[p95LIdx] : 0,
    decoderFps,
    decoderFpsMin,
    decoderFpsMean,
    audioErrors,
    errors: [...errors, ...rigHigh.stats.errors, ...rigLow.stats.errors],
  }
  status(
    `  high: vfps=${result.high.encodedFps.toFixed(1)} addP95=${result.high.addP95Ms.toFixed(1)}ms ` +
      `vpackets=${result.high.videoPacketCount} apackets=${result.high.audioPacketCount} ` +
      `drift=${result.high.avDriftMs.toFixed(0)}ms bytes=${(result.high.webmBytes / 1024).toFixed(0)}KB`,
  )
  status(
    `  low : vfps=${result.low.encodedFps.toFixed(1)} addP95=${result.low.addP95Ms.toFixed(1)}ms ` +
      `vpackets=${result.low.videoPacketCount} apackets=${result.low.audioPacketCount} ` +
      `drift=${result.low.avDriftMs.toFixed(0)}ms bytes=${(result.low.webmBytes / 1024).toFixed(0)}KB`,
  )
  status(
    `  decoders min=${decoderFpsMin.toFixed(1)} mean=${decoderFpsMean.toFixed(1)} fps; ` +
      `resize p95=${result.resizeP95Ms.toFixed(1)}ms; audioErrors=${result.audioErrors.length}`,
  )
  reportResult("audio-split-pipeline", params, result)
}

run().catch((error: unknown) => {
  status(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  reportResult("audio-split-pipeline", params, {
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  })
})
