import { type Component, createSignal, onCleanup, Show } from 'solid-js'
import { action, useAction, useSubmission } from '@solidjs/router'
import { requestMicrophoneAccess, createRecorder, type RecordingResult } from '~/lib/audio/recorder'
import styles from './Track.module.css'

let stream: MediaStream | null = null
let recorder: ReturnType<typeof createRecorder> | null = null

const startRecording = action(async () => {
  stream = await requestMicrophoneAccess()
  recorder = createRecorder(stream)
  recorder.start()
  return { started: true }
})

const stopRecording = action(async () => {
  if (!recorder) throw new Error('No active recorder')
  const result = await recorder.stop()
  return result
})

export const Track: Component = () => {
  const [isRecording, setIsRecording] = createSignal(false)

  const doStartRecording = useAction(startRecording)
  const doStopRecording = useAction(stopRecording)
  const startSubmission = useSubmission(startRecording)
  const stopSubmission = useSubmission(stopRecording)

  onCleanup(() => {
    stream?.getTracks().forEach((track) => track.stop())
  })

  const handleRecord = async () => {
    if (isRecording()) {
      await doStopRecording()
      setIsRecording(false)
    } else {
      await doStartRecording()
      setIsRecording(true)
    }
  }

  const handleClear = () => {
    stopSubmission.clear()
    startSubmission.clear()
  }

  const recording = () => stopSubmission.result as RecordingResult | undefined
  const error = () => startSubmission.error || stopSubmission.error

  return (
    <div class={styles.track}>
      <div class={styles.preview}>
        <Show when={recording()} fallback="No video">
          Audio: {recording()!.duration.toFixed(2)}s
        </Show>
      </div>
      <div class={styles.controls}>
        <button
          class={styles.recordButton}
          classList={{ [styles.recording]: isRecording() }}
          onClick={handleRecord}
          disabled={startSubmission.pending}
        >
          {startSubmission.pending ? '...' : isRecording() ? 'Stop' : 'Record'}
        </button>
        <Show when={recording()}>
          <button class={styles.clearButton} onClick={handleClear}>
            Clear
          </button>
        </Show>
      </div>
      <Show when={error()}>
        <div class={styles.error}>{String(error())}</div>
      </Show>
    </div>
  )
}

