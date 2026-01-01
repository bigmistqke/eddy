import { type Component, createSignal, createEffect, onCleanup, onMount, Show } from 'solid-js'
import { FiCircle, FiSquare, FiTrash2 } from 'solid-icons/fi'
import { requestMediaAccess, createRecorder, type RecordingResult } from '~/lib/audio/recorder'
import { createAudioPipeline, type AudioPipeline } from '~/lib/audio/pipeline'
import { resumeAudioContext } from '~/lib/audio/context'
import styles from './Track.module.css'

interface TrackProps {
  id: number
  isPlaying?: boolean
  currentTime?: number
  onVideoChange?: (index: number, video: HTMLVideoElement | null) => void
}

export const Track: Component<TrackProps> = (props) => {
  const [isRecording, setIsRecording] = createSignal(false)
  const [volume, setVolume] = createSignal(1)
  const [pan, setPan] = createSignal(0)
  const [recording, setRecording] = createSignal<RecordingResult | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [pending, setPending] = createSignal(false)
  const [playbackEl, setPlaybackEl] = createSignal<HTMLVideoElement | null>(null)

  let videoRef: HTMLVideoElement | undefined
  let pipeline: AudioPipeline | null = null
  let stream: MediaStream | null = null
  let recorder: ReturnType<typeof createRecorder> | null = null

  onMount(() => {
    pipeline = createAudioPipeline()
  })

  onCleanup(() => {
    stream?.getTracks().forEach((track) => track.stop())
    pipeline?.disconnect()
    props.onVideoChange?.(props.id, null)
  })

  // React to global play/pause
  createEffect(() => {
    const el = playbackEl()
    if (!el || !recording()) return
    if (props.isPlaying) {
      el.play()
    } else {
      el.pause()
    }
  })

  // React to seek (stop resets to 0)
  createEffect(() => {
    const el = playbackEl()
    const time = props.currentTime
    if (!el || time === undefined) return
    el.currentTime = time
  })

  const handleRecord = async () => {
    setError(null)

    if (isRecording()) {
      // Stop recording
      if (recorder) {
        const result = await recorder.stop()
        setRecording(result)
        stream?.getTracks().forEach((track) => track.stop())
        stream = null
      }
      if (videoRef) videoRef.srcObject = null
      setIsRecording(false)
    } else {
      // Start recording
      setPending(true)
      try {
        await resumeAudioContext()
        stream = await requestMediaAccess(true)
        recorder = createRecorder(stream)
        recorder.start()
        if (videoRef) {
          videoRef.srcObject = stream
          videoRef.play()
        }
        setIsRecording(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to start recording')
      } finally {
        setPending(false)
      }
    }
  }

  const handleClear = () => {
    const el = playbackEl()
    if (el) {
      el.pause()
      el.src = ''
    }
    setPlaybackEl(null)
    props.onVideoChange?.(props.id, null)
    pipeline?.disconnect()
    setRecording(null)
    setError(null)
  }

  const handleVolumeChange = (e: Event) => {
    const value = parseFloat((e.target as HTMLInputElement).value)
    setVolume(value)
    pipeline?.setVolume(value)
  }

  const handlePanChange = (e: Event) => {
    const value = parseFloat((e.target as HTMLInputElement).value)
    setPan(value)
    pipeline?.setPan(value)
  }

  const setupPlayback = (el: HTMLVideoElement) => {
    el.onloadeddata = () => {
      setPlaybackEl(el)
      if (pipeline) {
        pipeline.connect(el)
      }
      props.onVideoChange?.(props.id, el)
    }
  }

  const recordingUrl = () => {
    const rec = recording()
    return rec ? URL.createObjectURL(rec.blob) : undefined
  }

  return (
    <div class={styles.track}>
      <div class={styles.trackHeader}>
        <span class={styles.trackLabel}>Track {props.id + 1}</span>
        <Show when={recording()}>
          <span class={styles.status}>{props.isPlaying ? 'Playing' : 'Ready'}</span>
        </Show>
      </div>

      {/* Hidden video elements for playback */}
      <Show when={isRecording()}>
        <video ref={videoRef} class={styles.hiddenVideo} muted playsinline />
      </Show>
      <Show when={!isRecording() && recording()}>
        <video
          ref={setupPlayback}
          src={recordingUrl()}
          class={styles.hiddenVideo}
          playsinline
        />
      </Show>

      <div class={styles.sliders}>
        <label class={styles.slider}>
          <span>Vol</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume()}
            onInput={handleVolumeChange}
          />
        </label>
        <label class={styles.slider}>
          <span>Pan</span>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={pan()}
            onInput={handlePanChange}
          />
        </label>
      </div>

      <div class={styles.controls}>
        <button
          class={styles.recordButton}
          classList={{ [styles.recording]: isRecording() }}
          onClick={handleRecord}
          disabled={pending() || !!recording()}
        >
          {isRecording() ? <FiSquare size={14} /> : <FiCircle size={14} />}
        </button>
        <Show when={recording()}>
          <button class={styles.clearButton} onClick={handleClear}>
            <FiTrash2 size={14} />
          </button>
        </Show>
      </div>
      <Show when={error()}>
        <div class={styles.error}>{String(error())}</div>
      </Show>
    </div>
  )
}

