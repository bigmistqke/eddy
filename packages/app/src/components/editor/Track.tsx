import clsx from 'clsx'
import { FiDownload, FiTrash2 } from 'solid-icons/fi'
import { type Component, For } from 'solid-js'
import styles from './Track.module.css'

/** Effect metadata for rendering sliders */
interface EffectMeta {
  label: string
  min: number
  max: number
  step: number
  defaultValue: number
}

/** Map effect types to their UI metadata */
const VIDEO_EFFECT_META: Record<string, EffectMeta> = {
  'visual.brightness': { label: 'Bri', min: -100, max: 100, step: 1, defaultValue: 0 },
  'visual.contrast': { label: 'Con', min: 0, max: 200, step: 1, defaultValue: 100 },
  'visual.saturation': { label: 'Sat', min: 0, max: 200, step: 1, defaultValue: 100 },
}

/** Video effect from pipeline */
interface VideoEffect {
  type: string
  value?: { value: number }
}

interface TrackProps {
  trackId: string
  displayIndex: number
  hasClip: boolean
  isPlaying: boolean
  isSelected: boolean
  isRecording: boolean
  isLoading: boolean
  // Audio controls
  volume: number
  pan: number
  onVolumeChange: (value: number) => void
  onPanChange: (value: number) => void
  // Video pipeline
  videoPipeline: VideoEffect[]
  onVideoEffectChange: (effectIndex: number, value: number) => void
  // Actions
  onSelect: () => void
  onClear: () => void
  onDownload: () => void
}

export const Track: Component<TrackProps> = props => {
  function getStatus() {
    if (props.isLoading) return 'Loading...'
    if (props.isRecording) return 'Recording'
    if (props.isSelected) return 'Preview'
    if (props.isPlaying && props.hasClip) return 'Playing'
    if (props.hasClip) return 'Ready'
    return 'Empty'
  }

  return (
    <div
      role="button"
      tabIndex={0}
      class={clsx(
        styles.track,
        props.isSelected && styles.selected,
        props.isRecording && styles.recording,
        props.hasClip && styles.hasRecording,
      )}
      onClick={props.onSelect}
      onKeyDown={event => event.code === 'Enter' && props.onSelect()}
    >
      <div class={styles.trackHeader}>
        <span class={styles.trackLabel}>Track {props.displayIndex + 1}</span>
        <span class={styles.status}>{getStatus()}</span>
      </div>

      <div class={styles.body}>
        <div class={styles.sliders}>
          {/* Audio controls */}
          <label class={styles.slider}>
            <span>Vol</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={props.volume}
              onInput={e => props.onVolumeChange(parseFloat(e.target.value))}
              onClick={e => e.stopPropagation()}
            />
          </label>
          <label class={styles.slider}>
            <span>Pan</span>
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={props.pan}
              onInput={e => props.onPanChange(parseFloat(e.target.value))}
              onClick={e => e.stopPropagation()}
            />
          </label>
          {/* Video controls - generated from pipeline */}
          <For each={props.videoPipeline}>
            {(effect, index) => {
              const meta = VIDEO_EFFECT_META[effect.type]
              if (!meta) return null

              const value = () => effect.params?.value?.value ?? meta.defaultValue

              return (
                <label class={styles.slider}>
                  <span>{meta.label}</span>
                  <input
                    type="range"
                    min={meta.min}
                    max={meta.max}
                    step={meta.step}
                    value={value()}
                    onInput={e => props.onVideoEffectChange(index(), parseFloat(e.target.value))}
                    onClick={e => e.stopPropagation()}
                  />
                </label>
              )
            }}
          </For>
        </div>

        <div class={styles.controls}>
          <button
            type="button"
            class={styles.downloadButton}
            classList={{ [styles.hidden]: !props.hasClip }}
            onClick={e => {
              e.stopPropagation()
              props.onDownload()
            }}
            title="Download clip"
          >
            <FiDownload size={14} />
          </button>
          <button
            type="button"
            class={styles.clearButton}
            classList={{ [styles.hidden]: !props.hasClip }}
            onClick={e => {
              e.stopPropagation()
              props.onClear()
            }}
            title="Clear clip"
          >
            <FiTrash2 size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}
