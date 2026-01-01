import { type Component, createSignal, createEffect, onCleanup, onMount, Show } from 'solid-js'
import { FiTrash2 } from 'solid-icons/fi'
import { type RecordingResult } from '~/lib/audio/recorder'
import { createAudioPipeline, type AudioPipeline } from '~/lib/audio/pipeline'
import styles from './Track.module.css'

interface TrackProps {
  id: number
  isPlaying?: boolean
  isSelected?: boolean
  isRecording?: boolean
  isLoading?: boolean
  currentTime?: number
  recording: RecordingResult | null
  onSelect?: () => void
  onVideoChange?: (index: number, video: HTMLVideoElement | null) => void
  onClear?: () => void
}

export const Track: Component<TrackProps> = (props) => {
  const [volume, setVolume] = createSignal(1)
  const [pan, setPan] = createSignal(0)
  const [playbackEl, setPlaybackEl] = createSignal<HTMLVideoElement | null>(null)

  let pipeline: AudioPipeline | null = null

  onMount(() => {
    pipeline = createAudioPipeline()
  })

  onCleanup(() => {
    pipeline?.disconnect()
    props.onVideoChange?.(props.id, null)
  })

  // React to global play/pause and seek
  createEffect(() => {
    const el = playbackEl()
    if (!el || !props.recording) return

    // Seek if currentTime is specified
    if (props.currentTime !== undefined) {
      el.currentTime = props.currentTime
    }

    if (props.isPlaying) {
      el.play().catch(() => {
        // Ignore AbortError when play is interrupted by pause
      })
    } else {
      el.pause()
    }
  })

  const handleClear = () => {
    const el = playbackEl()
    if (el) {
      el.pause()
      el.src = ''
    }
    setPlaybackEl(null)
    pipeline?.disconnect()
    props.onClear?.()
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
    return props.recording ? URL.createObjectURL(props.recording.blob) : undefined
  }

  const getStatus = () => {
    if (props.isLoading) return 'Loading...'
    if (props.isRecording) return 'Recording'
    if (props.isSelected) return 'Preview'
    if (props.isPlaying && props.recording) return 'Playing'
    if (props.recording) return 'Ready'
    return 'Empty'
  }

  return (
    <div
      class={styles.track}
      classList={{
        [styles.selected]: props.isSelected,
        [styles.recording]: props.isRecording,
        [styles.hasRecording]: !!props.recording,
      }}
      onClick={props.onSelect}
    >
      <div class={styles.trackHeader}>
        <span class={styles.trackLabel}>Track {props.id + 1}</span>
        <span class={styles.status}>{getStatus()}</span>
      </div>

      {/* Hidden video element for playback */}
      <Show when={props.recording}>
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
            onClick={(e) => e.stopPropagation()}
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
            onClick={(e) => e.stopPropagation()}
          />
        </label>
      </div>

      <Show when={props.recording}>
        <div class={styles.controls}>
          <button class={styles.clearButton} onClick={(e) => { e.stopPropagation(); handleClear(); }}>
            <FiTrash2 size={14} />
          </button>
        </div>
      </Show>
    </div>
  )
}
