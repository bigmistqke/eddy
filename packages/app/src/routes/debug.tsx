/**
 * Debug route for testing video muxing in isolation with worker-based pipeline.
 *
 * Architecture:
 * Main Thread: MediaStreamTrackProcessor.readable → transfer → Capture Worker
 * Capture Worker: VideoFrame → copyTo(buffer) → RPC → Muxer Worker
 * Muxer Worker: queue → recreate VideoFrame → VideoSample → mux
 */

import { createSignal, onCleanup, Show } from 'solid-js'
import { transfer } from '@bigmistqke/rpc/messenger'
import {
  createDebugCaptureWorker,
  createDebugMuxerWorker,
  type WorkerHandle,
} from '../workers/create-worker'
import type { CaptureWorkerMethods, MuxerWorkerMethods } from '../workers/debug-types'

export default function Debug() {
  const [status, setStatus] = createSignal<string>('idle')
  const [isRecording, setIsRecording] = createSignal(false)
  const [log, setLog] = createSignal<string[]>([])

  let stream: MediaStream | null = null
  let captureWorker: WorkerHandle<CaptureWorkerMethods> | null = null
  let muxerWorker: WorkerHandle<MuxerWorkerMethods> | null = null

  const addLog = (msg: string) => {
    console.log(`[debug] ${msg}`)
    setLog(prev => [...prev, `${new Date().toISOString().slice(11, 23)} ${msg}`])
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

      // Create workers using factory functions (RPC-enabled)
      addLog('creating workers...')
      captureWorker = createDebugCaptureWorker()
      muxerWorker = createDebugMuxerWorker()
      addLog('workers created')

      // Create MessageChannel to connect capture → muxer
      const channel = new MessageChannel()

      // Set up ports via RPC
      addLog('setting up worker ports...')
      await muxerWorker.rpc.setCapturePort(transfer(channel.port2) as unknown as MessagePort)
      await captureWorker.rpc.setMuxerPort(transfer(channel.port1) as unknown as MessagePort)
      addLog('ports configured')

      // Create processor and start capture
      addLog('creating processor and starting capture...')
      const processor = new MediaStreamTrackProcessor({ track: videoTrack })

      // Start capture (don't await - it runs until stop is called)
      captureWorker.rpc.start(transfer(processor.readable) as unknown as ReadableStream<VideoFrame>)
        .then(() => addLog('capture completed'))
        .catch(err => addLog(`capture error: ${err}`))

      setIsRecording(true)
      setStatus('recording...')
      addLog('recording started')
    } catch (e) {
      addLog(`error: ${e}`)
      setStatus(`error: ${e}`)
      cleanup()
    }
  }

  async function stopRecording() {
    setStatus('stopping...')
    addLog('stopping')

    // Tell capture worker to stop
    await captureWorker?.rpc.stop()

    // Stop camera
    stream?.getTracks().forEach(t => t.stop())
    stream = null

    setIsRecording(false)

    // Finalize muxer and get blob
    addLog('finalizing...')
    try {
      const result = await muxerWorker?.rpc.finalize()
      if (result) {
        const { blob, frameCount } = result
        addLog(`finalized: ${frameCount} frames, ${blob.size} bytes`)

        if (blob.size > 0) {
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = `debug-${Date.now()}.webm`
          a.click()
          URL.revokeObjectURL(url)
          setStatus(`done! ${frameCount} frames, ${blob.size} bytes`)
        } else {
          setStatus('done (no data)')
        }
      }
    } catch (e) {
      addLog(`finalize error: ${e}`)
      setStatus(`error: ${e}`)
    }

    cleanup()
  }

  function cleanup() {
    captureWorker?.terminate()
    muxerWorker?.terminate()
    captureWorker = null
    muxerWorker = null
    stream?.getTracks().forEach(t => t.stop())
    stream = null
    setIsRecording(false)
  }

  onCleanup(cleanup)

  return (
    <div style={{ padding: '20px', 'font-family': 'monospace' }}>
      <h1>Video Muxing Debug (Workers + RPC)</h1>

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
      </div>

      <div style={{ 'margin-bottom': '10px' }}><strong>Status:</strong> {status()}</div>

      <div style={{ background: '#111', color: '#0f0', padding: '10px', height: '400px', 'overflow-y': 'auto', 'font-size': '11px' }}>
        {log().map(line => <div>{line}</div>)}
      </div>
    </div>
  )
}
