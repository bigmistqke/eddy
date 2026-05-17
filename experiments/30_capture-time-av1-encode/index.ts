// capture-time-av1-encode — pulls VideoFrames live from the camera
// via MediaStreamTrackProcessor, downscales to per-K cell mip res
// via OffscreenCanvas, encodes to AV1 via mediabunny's
// VideoSampleSource → WebMOutput → BufferTarget pipeline. Measures
// whether the encoder keeps up with realtime camera at each mip.

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedPacketSink,
  Input,
  Output,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
} from "mediabunny"
import { wait } from "../../src/utils"
import { reportResult, status } from "../harness/report"

const params = {
  captureSeconds: 10,
  captureResolution: { width: 1280, height: 720 },
  bitratePerPixel: 0.1,
  codec: "av1" as const,
  passes: [
    { label: "540p", width: 960, height: 544 },
    { label: "270p", width: 480, height: 272 },
    { label: "180p", width: 320, height: 184 },
  ],
}

interface PassResult {
  label: string
  width: number
  height: number
  cameraFps: number
  encodedFps: number
  dropRatio: number
  framesFromCamera: number
  framesEncoded: number
  encodedAddMaxMs: number
  encodedAddP95Ms: number
  firstFrameMs: number
  finalizeMs: number
  webmBytes: number
  webmBytesPerSecond: number
  roundTripDemuxed: number
  roundTripVerified: boolean
  errors: string[]
}

async function runPass(
  stream: MediaStream,
  pass: (typeof params.passes)[number],
): Promise<PassResult> {
  const errors: string[] = []
  status(`PASS ${pass.label} (${pass.width}×${pass.height})`)

  const [track] = stream.getVideoTracks()
  if (track === undefined) {
    throw new Error(`runPass: no video track`)
  }
  const Ctor = (window as unknown as {
    MediaStreamTrackProcessor: new (init: { track: MediaStreamTrack }) => {
      readable: ReadableStream<VideoFrame>
    }
  }).MediaStreamTrackProcessor
  const processor = new Ctor({ track })
  const reader = processor.readable.getReader()

  const canvas = new OffscreenCanvas(pass.width, pass.height)
  const context = canvas.getContext("2d")
  if (context === null) {
    throw new Error("runPass: no 2d context")
  }

  const output = new Output({
    format: new WebMOutputFormat(),
    target: new BufferTarget(),
  })
  const bitrate = Math.round(pass.width * pass.height * 30 * params.bitratePerPixel)
  const videoSource = new VideoSampleSource({
    codec: params.codec,
    bitrate,
  })
  output.addVideoTrack(videoSource)
  await output.start()

  const startMs = performance.now()
  let firstFrameMs = 0
  let framesFromCamera = 0
  let framesEncoded = 0
  const addTimings: number[] = []
  const deadline = startMs + params.captureSeconds * 1000

  // Pull frames from the camera, downscale, encode. Continue until
  // the deadline; then stop the reader and wait briefly for in-flight
  // adds to complete.
  while (performance.now() < deadline) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }
    framesFromCamera++
    try {
      context.drawImage(value, 0, 0, pass.width, pass.height)
      const scaledFrame = new VideoFrame(canvas, { timestamp: value.timestamp })
      const sample = new VideoSample(scaledFrame)
      const addStart = performance.now()
      try {
        await videoSource.add(sample)
        const addMs = performance.now() - addStart
        addTimings.push(addMs)
        framesEncoded++
        if (firstFrameMs === 0) {
          firstFrameMs = performance.now() - startMs
        }
      } catch (error) {
        errors.push(`add: ${error instanceof Error ? error.message : String(error)}`)
      }
      sample.close()
      scaledFrame.close()
    } catch (error) {
      errors.push(`process: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      value.close()
    }
  }

  // Release the reader, finalize output.
  try {
    reader.releaseLock()
  } catch {}
  try {
    track.stop()
  } catch {}
  const finalizeStart = performance.now()
  videoSource.close()
  await output.finalize()
  const finalizeMs = performance.now() - finalizeStart

  const buffer = (output.target as BufferTarget).buffer
  const webmBytes = buffer === null ? 0 : buffer.byteLength
  const webmBlob = buffer === null ? null : new Blob([buffer], { type: "video/webm" })

  // Re-demux to verify the WebM is well-formed AV1.
  let roundTripDemuxed = 0
  let roundTripVerified = false
  if (webmBlob !== null) {
    try {
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(webmBlob) })
      const videoTracks = await input.getVideoTracks()
      const videoTrack = videoTracks[0] ?? null
      if (videoTrack !== null) {
        const sink = new EncodedPacketSink(videoTrack)
        for await (const _packet of sink.packets()) {
          roundTripDemuxed++
        }
        roundTripVerified = roundTripDemuxed === framesEncoded
      }
    } catch (error) {
      errors.push(`roundtrip: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const sortedAdd = addTimings.slice().sort((a, b) => a - b)
  const p95Idx = Math.min(sortedAdd.length - 1, Math.floor(sortedAdd.length * 0.95))
  const result: PassResult = {
    label: pass.label,
    width: pass.width,
    height: pass.height,
    framesFromCamera,
    framesEncoded,
    cameraFps: framesFromCamera / params.captureSeconds,
    encodedFps: framesEncoded / params.captureSeconds,
    dropRatio:
      framesFromCamera === 0 ? 0 : (framesFromCamera - framesEncoded) / framesFromCamera,
    encodedAddMaxMs: sortedAdd.length > 0 ? sortedAdd[sortedAdd.length - 1] : 0,
    encodedAddP95Ms: sortedAdd.length > 0 ? sortedAdd[p95Idx] : 0,
    firstFrameMs,
    finalizeMs,
    webmBytes,
    webmBytesPerSecond: webmBytes / params.captureSeconds,
    roundTripDemuxed,
    roundTripVerified,
    errors,
  }
  status(
    `  cameraFps=${result.cameraFps.toFixed(1)} encodedFps=${result.encodedFps.toFixed(1)} ` +
      `drops=${(result.dropRatio * 100).toFixed(1)}% addP95=${result.encodedAddP95Ms.toFixed(1)}ms ` +
      `webm=${(result.webmBytes / 1024).toFixed(0)}KB ` +
      `firstFrame=${result.firstFrameMs.toFixed(0)}ms finalize=${result.finalizeMs.toFixed(0)}ms ` +
      `roundTrip=${result.roundTripDemuxed}/${result.framesEncoded} ok=${result.roundTripVerified}`,
  )
  return result
}

async function run(): Promise<void> {
  status(`capture-time-av1-encode: ${params.passes.length} resolutions × ${params.captureSeconds}s`)
  status(`opening camera...`)
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: params.captureResolution.width,
      height: params.captureResolution.height,
    },
    audio: false,
  })
  const settings = stream.getVideoTracks()[0]?.getSettings()
  status(`  camera native ${settings?.width}×${settings?.height}`)

  const reports: PassResult[] = []
  for (const pass of params.passes) {
    // Re-acquire a fresh stream per pass so the TrackProcessor isn't
    // reused across passes (cleaner state).
    const passStream =
      reports.length === 0
        ? stream
        : await navigator.mediaDevices.getUserMedia({
            video: {
              width: params.captureResolution.width,
              height: params.captureResolution.height,
            },
            audio: false,
          })
    try {
      const report = await runPass(passStream, pass)
      reports.push(report)
    } catch (error) {
      status(`  FAILED: ${error instanceof Error ? error.message : String(error)}`)
      reports.push({
        label: pass.label,
        width: pass.width,
        height: pass.height,
        cameraFps: 0,
        encodedFps: 0,
        dropRatio: 1,
        framesFromCamera: 0,
        framesEncoded: 0,
        encodedAddMaxMs: 0,
        encodedAddP95Ms: 0,
        firstFrameMs: 0,
        finalizeMs: 0,
        webmBytes: 0,
        webmBytesPerSecond: 0,
        roundTripDemuxed: 0,
        roundTripVerified: false,
        errors: [error instanceof Error ? error.message : String(error)],
      })
    } finally {
      if (passStream !== stream) {
        for (const t of passStream.getTracks()) {
          try {
            t.stop()
          } catch {}
        }
      }
    }
    await wait(500)
  }
  // Final cleanup of the original stream.
  for (const t of stream.getTracks()) {
    try {
      t.stop()
    } catch {}
  }
  status("done.")
  reportResult("capture-time-av1-encode", params, { passes: reports })
}

run().catch((error: unknown) => {
  status(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  reportResult("capture-time-av1-encode", params, {
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  })
})
