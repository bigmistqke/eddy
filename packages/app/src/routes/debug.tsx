/**
 * Debug route for testing video muxing and playback in isolation.
 *
 * 1. Record camera to webm (working)
 * 2. Play back the webm on a canvas (testing)
 */

import { $MESSENGER, rpc, transfer } from '@bigmistqke/rpc/messenger'
import type { Demuxer } from '@eddy/media'
import { action, defer, hold, resource } from '@eddy/solid'
import { createSignal, Match, Show, Switch } from 'solid-js'
import type { CaptureWorkerMethods } from '~/workers/debug-capture.worker'
import DebugCaptureWorker from '~/workers/debug-capture.worker?worker'
import type { MuxerWorkerMethods } from '~/workers/debug-muxer.worker'
import DebugMuxerWorker from '~/workers/debug-muxer.worker?worker'
import type { DemuxWorkerMethods } from '~/workers/demux.worker'
import DemuxWorker from '~/workers/demux.worker?worker'

export default function Debug() {
  const [log, setLog] = createSignal<string[]>([])
  const [recordedBlob, setRecordedBlob] = createSignal<Blob | null>(null)
  let canvasRef: HTMLCanvasElement | undefined

  const addLog = (msg: string) => {
    console.log(`[debug] ${msg}`)
    setLog(prev => [...prev, `${new Date().toISOString().slice(11, 23)} ${msg}`])
  }

  // Pre-initialize workers on mount
  const [workers] = resource(async ({ onCleanup }) => {
    addLog('creating workers...')
    const capture = rpc<CaptureWorkerMethods>(new DebugCaptureWorker())
    const muxer = rpc<MuxerWorkerMethods>(new DebugMuxerWorker())

    const channel = new MessageChannel()
    await Promise.all([
      muxer.setCapturePort(transfer(channel.port2)),
      capture.setMuxerPort(transfer(channel.port1)),
    ])

    await muxer.preInit()
    addLog('workers ready')

    onCleanup(() => {
      capture[$MESSENGER].terminate()
      muxer[$MESSENGER].terminate()
    })

    return { capture, muxer }
  })

  const getUserMedia = action(async function (_: undefined, { onCleanup }) {
    addLog('requesting camera')
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: 640, height: 480 },
      audio: false,
    })
    onCleanup(() => stream.getTracks().forEach(track => track.stop()))
    return stream
  })

  const record = action(function* (_: undefined, { onCleanup }) {
    const _workers = workers()
    if (!_workers) throw new Error('Workers not ready')

    const stream = yield* defer(getUserMedia())
    const videoTrack = stream.getVideoTracks()[0]
    const settings = videoTrack?.getSettings()
    addLog(`camera: ${settings?.width}x${settings?.height} @ ${settings?.frameRate}fps`)

    const processor = new MediaStreamTrackProcessor({ track: videoTrack })
    const capturePromise = _workers.capture
      .start(transfer(processor.readable))
      .then(() => addLog('capture completed'))
      .catch((err: unknown) => addLog(`capture error: ${err}`))

    onCleanup(async () => {
      addLog('stopping capture...')
      await _workers.capture.stop()
      await capturePromise
    })

    addLog('recording...')
    return hold()
  })

  const finalize = action(async () => {
    const _workers = workers()
    if (!_workers) return null

    addLog('finalizing...')
    const result = await _workers.muxer.finalize()
    addLog(`finalized: ${result.frameCount} frames, ${result.blob.size} bytes`)

    await _workers.muxer.reset()
    await _workers.muxer.preInit()

    if (result.blob.size > 0) {
      setRecordedBlob(result.blob)
      return result.blob
    }
    return null
  })

  async function handleStop() {
    record.cancel()
    await finalize()
  }

  // TODO: Restore when @eddy/playback module is created
  // Playback action - demux and play the recorded blob on canvas
  const playback = action(async (_blob: Blob, { onCleanup: _onCleanup }) => {
    addLog('playback not yet implemented - @eddy/playback module needs to be created')
    return null
  })

  const status = () => {
    if (workers.loading) return 'initializing workers...'
    if (workers.error) return `error: ${workers.error}`
    if (record.pending()) return 'recording...'
    if (playback.pending()) return 'playing...'
    return 'ready'
  }

  return (
    <div style={{ padding: '20px', 'font-family': 'monospace' }}>
      <h1>Debug: Record → Playback</h1>

      <div style={{ 'margin-bottom': '20px', display: 'flex', gap: '10px' }}>
        <Switch>
          <Match when={workers.loading}>
            <button disabled style={{ padding: '10px 20px' }}>
              Initializing...
            </button>
          </Match>
          <Match when={record.pending()}>
            <button
              onClick={handleStop}
              style={{ padding: '10px 20px', background: '#c00', color: 'white' }}
            >
              Stop Recording
            </button>
          </Match>
          <Match when={workers()}>
            <button
              onClick={() => record.try()}
              style={{ padding: '10px 20px', background: '#0a0', color: 'white' }}
            >
              Record
            </button>
          </Match>
        </Switch>

        <Show when={recordedBlob() && !playback.pending()}>
          <button
            onClick={() => playback(recordedBlob()!)}
            style={{ padding: '10px 20px', background: '#00a', color: 'white' }}
          >
            Play on Canvas
          </button>
        </Show>
      </div>

      <div style={{ 'margin-bottom': '10px' }}>
        <strong>Status:</strong> {status()}
      </div>

      {/* Canvas for playback */}
      <canvas
        ref={canvasRef}
        width={640}
        height={480}
        style={{ background: '#222', 'margin-bottom': '20px', display: 'block' }}
      />

      {/* Log output */}
      <div
        style={{
          background: '#111',
          color: '#0f0',
          padding: '10px',
          height: '200px',
          'overflow-y': 'auto',
          'font-size': '11px',
        }}
      >
        {log().map(line => (
          <div>{line}</div>
        ))}
      </div>
    </div>
  )
}
