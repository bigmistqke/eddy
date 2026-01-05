/**
 * Debug route for testing video muxing in isolation.
 *
 * Pipeline to avoid VideoFrame backpressure:
 * 1. Read VideoFrame → copy to ArrayBuffer → close VideoFrame immediately
 * 2. Queue: { buffer, width, height, timestampSec }
 * 3. Process: recreate VideoFrame from buffer → VideoSample → mux
 */

import {
  BufferTarget,
  Output,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
} from 'mediabunny'
import { createSignal, onCleanup, Show } from 'solid-js'

interface QueuedFrame {
  buffer: ArrayBuffer
  format: VideoPixelFormat
  codedWidth: number
  codedHeight: number
  timestampSec: number
  queuedAt: number
}

export default function Debug() {
  const [status, setStatus] = createSignal<string>('idle')
  const [isRecording, setIsRecording] = createSignal(false)
  const [log, setLog] = createSignal<string[]>([])
  const [artificialDelay, setArtificialDelay] = createSignal(0)

  let stream: MediaStream | null = null
  let output: Output | null = null
  let bufferTarget: BufferTarget | null = null
  let videoSource: VideoSampleSource | null = null
  let videoReader: ReadableStreamDefaultReader<VideoFrame> | null = null
  let recording = false
  let firstVideoTimestamp: number | null = null

  // Stats
  let queuedCount = 0
  let encodedCount = 0
  let maxQueueSize = 0
  let maxQueueWait = 0

  // Frame queue
  let frameQueue: QueuedFrame[] = []
  let isProcessingQueue = false

  const addLog = (msg: string) => {
    console.log(`[debug] ${msg}`)
    setLog(prev => [...prev, `${new Date().toISOString().slice(11, 23)} ${msg}`])
  }

  async function processFrameQueue() {
    if (isProcessingQueue || !videoSource) return
    isProcessingQueue = true

    const delay = artificialDelay()

    while (frameQueue.length > 0) {
      const item = frameQueue.shift()!
      const { buffer, format, codedWidth, codedHeight, timestampSec, queuedAt } = item

      const queueWait = performance.now() - queuedAt
      maxQueueWait = Math.max(maxQueueWait, queueWait)

      try {
        // Artificial delay to simulate slow encoder
        if (delay > 0) {
          await new Promise(r => setTimeout(r, delay))
        }

        // Recreate VideoFrame from buffer with original timestamp and format
        const frame = new VideoFrame(buffer, {
          format,
          codedWidth,
          codedHeight,
          timestamp: timestampSec * 1_000_000,
        })

        const sample = new VideoSample(frame)
        sample.setTimestamp(timestampSec)
        await videoSource.add(sample)
        sample[Symbol.dispose]?.()
        frame.close()

        encodedCount++
        addLog(`encoded ${encodedCount}: ts=${(timestampSec * 1000).toFixed(0)}ms, wait=${queueWait.toFixed(0)}ms, q=${frameQueue.length}`)
      } catch (e) {
        addLog(`encode error: ${e}`)
      }
    }

    isProcessingQueue = false
  }

  async function processVideoStream(readable: ReadableStream<VideoFrame>) {
    addLog('reading frames...')
    videoReader = readable.getReader()

    try {
      while (recording) {
        const { done, value: frame } = await videoReader.read()
        if (done || !frame) {
          addLog('stream ended')
          break
        }

        if (firstVideoTimestamp === null) {
          firstVideoTimestamp = frame.timestamp
          addLog(`first ts: ${firstVideoTimestamp}, format: ${frame.format}`)
        }

        const timestampSec = (frame.timestamp - firstVideoTimestamp) / 1_000_000
        const format = frame.format!
        const codedWidth = frame.codedWidth
        const codedHeight = frame.codedHeight

        // Copy frame data to buffer IMMEDIATELY, then close to release hardware resource
        // Use allocationSize() to get correct buffer size for the actual pixel format
        const buffer = new ArrayBuffer(frame.allocationSize())
        await frame.copyTo(buffer)
        frame.close() // Release immediately!

        frameQueue.push({ buffer, format, codedWidth, codedHeight, timestampSec, queuedAt: performance.now() })
        queuedCount++
        maxQueueSize = Math.max(maxQueueSize, frameQueue.length)

        addLog(`queued ${queuedCount}: ts=${(timestampSec * 1000).toFixed(0)}ms, q=${frameQueue.length}`)

        // Kick off processing (non-blocking)
        processFrameQueue()
      }
    } catch (e) {
      addLog(`read error: ${e}`)
    }

    // Drain
    addLog(`draining: ${frameQueue.length} frames`)
    while (frameQueue.length > 0 || isProcessingQueue) {
      if (frameQueue.length > 0 && !isProcessingQueue) processFrameQueue()
      await new Promise(r => setTimeout(r, 50))
    }

    addLog(`done: queued=${queuedCount}, encoded=${encodedCount}, maxQ=${maxQueueSize}, maxWait=${maxQueueWait.toFixed(0)}ms`)
  }

  async function startRecording() {
    try {
      setStatus('requesting camera...')
      addLog('requesting camera')

      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
        audio: false,
      })

      const videoTrack = stream.getVideoTracks()[0]
      const settings = videoTrack?.getSettings()
      addLog(`camera: ${settings?.width}x${settings?.height} @ ${settings?.frameRate}fps`)

      // Reset
      recording = true
      firstVideoTimestamp = null
      queuedCount = 0
      encodedCount = 0
      maxQueueSize = 0
      maxQueueWait = 0
      frameQueue = []
      isProcessingQueue = false

      // Muxer
      bufferTarget = new BufferTarget()
      output = new Output({ format: new WebMOutputFormat(), target: bufferTarget })

      videoSource = new VideoSampleSource({ codec: 'vp9', bitrate: 2_000_000 })
      output.addVideoTrack(videoSource)

      addLog(`delay: ${artificialDelay()}ms`)
      await output.start()

      if (videoTrack) {
        const processor = new MediaStreamTrackProcessor({ track: videoTrack })
        processVideoStream(processor.readable)
      }

      setIsRecording(true)
      setStatus('recording...')
    } catch (e) {
      addLog(`error: ${e}`)
      setStatus(`error: ${e}`)
    }
  }

  async function stopRecording() {
    try {
      setStatus('stopping...')
      addLog('stopping')
      recording = false

      if (videoReader) {
        await videoReader.cancel().catch(() => {})
        videoReader = null
      }

      if (stream) {
        stream.getTracks().forEach(t => t.stop())
        stream = null
      }

      // Wait for drain
      while (frameQueue.length > 0 || isProcessingQueue) {
        await new Promise(r => setTimeout(r, 50))
      }

      if (output && bufferTarget) {
        if (videoSource) await videoSource.close()
        await output.finalize()

        const buffer = bufferTarget.buffer
        if (buffer && buffer.byteLength > 0) {
          const blob = new Blob([buffer], { type: 'video/webm' })
          addLog(`output: ${blob.size} bytes`)

          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `debug-${Date.now()}.webm`
          a.click()
          URL.revokeObjectURL(url)

          setStatus(`done! ${queuedCount} frames, ${blob.size} bytes`)
        } else {
          setStatus('error: no data')
        }
      }

      output = null
      bufferTarget = null
      videoSource = null
      setIsRecording(false)
    } catch (e) {
      addLog(`error: ${e}`)
      setStatus(`error: ${e}`)
      setIsRecording(false)
    }
  }

  onCleanup(() => {
    recording = false
    stream?.getTracks().forEach(t => t.stop())
    frameQueue = []
  })

  return (
    <div style={{ padding: '20px', 'font-family': 'monospace' }}>
      <h1>Video Muxing Debug</h1>

      <div style={{ 'margin-bottom': '20px', display: 'flex', gap: '20px', 'align-items': 'center' }}>
        <Show
          when={!isRecording()}
          fallback={
            <button onClick={stopRecording} style={{ padding: '20px 40px', 'font-size': '18px', background: '#c00', color: 'white', border: 'none', cursor: 'pointer' }}>
              Stop
            </button>
          }
        >
          <button onClick={startRecording} style={{ padding: '20px 40px', 'font-size': '18px', background: '#0a0', color: 'white', border: 'none', cursor: 'pointer' }}>
            Record
          </button>
        </Show>

        <label style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
          Delay:
          <input type="range" min="0" max="1000" value={artificialDelay()} onInput={e => setArtificialDelay(parseInt(e.target.value))} disabled={isRecording()} style={{ width: '150px' }} />
          {artificialDelay()}ms
        </label>
      </div>

      <div style={{ 'margin-bottom': '10px' }}><strong>Status:</strong> {status()}</div>

      <div style={{ background: '#111', color: '#0f0', padding: '10px', height: '400px', 'overflow-y': 'auto', 'font-size': '11px' }}>
        {log().map(line => <div>{line}</div>)}
      </div>
    </div>
  )
}
