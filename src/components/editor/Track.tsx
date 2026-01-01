import { type Component, createSignal, onCleanup, Show } from 'solid-js'
import { action, useAction, useSubmission } from '@solidjs/router'
import { requestMediaAccess, createRecorder, type RecordingResult } from '~/lib/audio/recorder'
import styles from './Track.module.css'

let stream: MediaStream | null = null
let recorder: ReturnType<typeof createRecorder> | null = null

const startRecording = action(async () => {
  stream = await requestMediaAccess(true)
  recorder = createRecorder(stream)
  recorder.start()
  return { started: true, stream }
})

const stopRecording = action(async () => {
  if (!recorder) throw new Error('No active recorder')
  const result = await recorder.stop()
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
  return result
})

export const Track: Component = () => {
  const [isRecording, setIsRecording] = createSignal(false)
  let videoRef: HTMLVideoElement | undefined

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
      if (videoRef) videoRef.srcObject = null
      setIsRecording(false)
    } else {
      const result = await doStartRecording()
      if (result && videoRef && stream) {
        videoRef.srcObject = stream
        videoRef.play()
      }
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
        <Show when={isRecording()}>
          <video ref={videoRef} class={styles.video} muted playsinline />
        </Show>
        <Show when={!isRecording() && recording()}>
          <span>Video: {recording()!.duration.toFixed(2)}s</span>
        </Show>
        <Show when={!isRecording() && !recording()}>
          <span>No video</span>
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

