// bitmap-during-record — generate bitmaps in a Worker via
// MediaStreamTrackProcessor while MediaRecorder encodes the same stream.
// Goal: bitmap series ready the moment recording stops.

import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input } from "mediabunny"
import { wait } from "../../src/utils"
import { reportResult, status } from "../harness/report"

const params = {
  captureResolution: { width: 1280, height: 720 },
  bitmapResolution: { width: 96, height: 174 },
  recordSeconds: 4,
}

interface ProgressMessage {
  type: "progress"
  latencyMs: number
}

interface DoneMessage {
  type: "done"
  bitmapsEmitted: number
}

type WorkerMessage = ProgressMessage | DoneMessage

async function runPass(): Promise<{
  recordedFrames: number
  bitmapsEmitted: number
  meanLatencyMs: number
  maxLatencyMs: number
}> {
  // MediaStreamTrackProcessor is the production path on Chrome. If it's
  // not present, fail fast — the alternative is rVFC on the main thread,
  // worth its own experiment.
  const processorCtor = (globalThis as unknown as {
    MediaStreamTrackProcessor?: new (init: { track: MediaStreamTrack }) => {
      readable: ReadableStream<VideoFrame>
    }
  }).MediaStreamTrackProcessor
  if (processorCtor === undefined) {
    throw new Error("MediaStreamTrackProcessor not available — fall back to rVFC path")
  }

  status(`getUserMedia + start worker + start MediaRecorder...`)
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: params.captureResolution.width, height: params.captureResolution.height },
    audio: true,
  })
  const videoTrack = stream.getVideoTracks()[0]
  // Clone the track so the bitmap pipeline doesn't consume the same
  // frames MediaRecorder needs. Both clones pull from the same camera
  // source independently.
  const bitmapTrack = videoTrack.clone()
  const processor = new processorCtor({ track: bitmapTrack })

  const worker = new Worker(new URL("./bitmap-worker.ts", import.meta.url), { type: "module" })
  const latencies: number[] = []
  const { promise: workerDone, resolve: resolveWorkerDone } = Promise.withResolvers<DoneMessage>()
  worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
    const message = event.data
    if (message.type === "progress") {
      latencies.push(message.latencyMs)
    } else {
      resolveWorkerDone(message)
    }
  }
  worker.postMessage(
    {
      readable: processor.readable,
      bitmapWidth: params.bitmapResolution.width,
      bitmapHeight: params.bitmapResolution.height,
    },
    [processor.readable as unknown as Transferable],
  )

  // MediaRecorder uses the original (un-cloned) tracks — encode path is
  // untouched, the bitmap pipeline runs in parallel.
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
  await wait(params.recordSeconds * 1000)
  recorder.stop()
  await stopped

  // Stop the bitmap track so the processor's readable closes and the
  // worker's reader returns done.
  bitmapTrack.stop()
  const done = await workerDone
  worker.terminate()

  for (const track of stream.getTracks()) {
    track.stop()
  }

  const blob = new Blob(blobParts, { type: mimeType })
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  const recordedTrack = await input.getPrimaryVideoTrack()
  if (recordedTrack === null) {
    throw new Error("runPass: no video track in recording")
  }
  const sink = new EncodedPacketSink(recordedTrack)
  let recordedFrames = 0
  for await (const _packet of sink.packets()) {
    recordedFrames++
  }

  const meanLatency = latencies.length === 0 ? 0 : latencies.reduce((a, b) => a + b, 0) / latencies.length
  const maxLatency = latencies.length === 0 ? 0 : Math.max(...latencies)
  return {
    recordedFrames,
    bitmapsEmitted: done.bitmapsEmitted,
    meanLatencyMs: meanLatency,
    maxLatencyMs: maxLatency,
  }
}

async function run(): Promise<void> {
  status(`bitmap-during-record pass (${params.recordSeconds}s, bitmap ${params.bitmapResolution.width}x${params.bitmapResolution.height})...`)
  const pass = await runPass()
  status(
    `  recordedFrames=${pass.recordedFrames}, bitmapsEmitted=${pass.bitmapsEmitted}, ` +
      `meanLatency=${pass.meanLatencyMs.toFixed(2)}ms, maxLatency=${pass.maxLatencyMs.toFixed(2)}ms`,
  )
  const keepUpRatio = pass.recordedFrames === 0 ? 0 : pass.bitmapsEmitted / pass.recordedFrames
  status(`  keep-up ratio = ${(keepUpRatio * 100).toFixed(1)}%`)
  status("done.")
  reportResult("bitmap-during-record", params, {
    ...pass,
    keepUpRatio,
  })
}

run().catch((error: unknown) => {
  status(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  reportResult("bitmap-during-record", params, {
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  })
})
