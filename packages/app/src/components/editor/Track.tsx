import type { EffectValue } from '@eddy/video'
import clsx from 'clsx'
import { FiDownload, FiTrash2 } from 'solid-icons/fi'
import { type Component, For } from 'solid-js'
import styles from './Track.module.css'

/** Param metadata for rendering controls */
interface ScalarParamMeta {
  type: 'scalar'
  label: string
  min: number
  max: number
  step: number
  defaultValue: number
}

interface VectorParamMeta {
  type: 'vector'
  label: string
  components: string[] // e.g., ['R', 'G', 'B'] or ['X', 'Y', 'Z']
  min: number
  max: number
  step: number
  defaultValue: number[]
}

type ParamMeta = ScalarParamMeta | VectorParamMeta

/** Effect metadata with params */
interface EffectMeta {
  params: Record<string, ParamMeta>
}

/** Map effect types to their UI metadata */
const VIDEO_EFFECT_META: Record<string, EffectMeta> = {
  'visual.brightness': {
    params: {
      value: { type: 'scalar', label: 'Bri', min: -100, max: 100, step: 1, defaultValue: 0 },
    },
  },
  'visual.contrast': {
    params: {
      value: { type: 'scalar', label: 'Con', min: 0, max: 200, step: 1, defaultValue: 100 },
    },
  },
  'visual.saturation': {
    params: {
      value: { type: 'scalar', label: 'Sat', min: 0, max: 200, step: 1, defaultValue: 100 },
    },
  },
  'visual.colorize': {
    params: {
      color: {
        type: 'vector',
        label: 'Color',
        components: ['R', 'G', 'B'],
        min: 0,
        max: 100,
        step: 1,
        defaultValue: [100, 100, 100],
      },
      intensity: { type: 'scalar', label: 'Int', min: 0, max: 100, step: 1, defaultValue: 0 },
    },
  },
}

/** Video effect from pipeline */
interface VideoEffect {
  type: string
  params?: Record<string, { value: number | number[] }>
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
  onVideoEffectParamChange: (effectIndex: number, paramKey: string, value: EffectValue) => void
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
            {(effect, effectIndex) => {
              const effectMeta = VIDEO_EFFECT_META[effect.type]
              if (!effectMeta) return null

              return (
                <For each={Object.entries(effectMeta.params)}>
                  {([paramKey, paramMeta]) => {
                    if (paramMeta.type === 'scalar') {
                      const value = () =>
                        (effect.params?.[paramKey]?.value as number) ?? paramMeta.defaultValue

                      return (
                        <label class={styles.slider}>
                          <span>{paramMeta.label}</span>
                          <input
                            type="range"
                            min={paramMeta.min}
                            max={paramMeta.max}
                            step={paramMeta.step}
                            value={value()}
                            onInput={e =>
                              props.onVideoEffectParamChange(
                                effectIndex(),
                                paramKey,
                                parseFloat(e.target.value),
                              )
                            }
                            onClick={e => e.stopPropagation()}
                          />
                        </label>
                      )
                    }

                    // Vector param - row of number inputs
                    const values = () =>
                      (effect.params?.[paramKey]?.value as number[]) ?? paramMeta.defaultValue

                    return (
                      <div class={styles.vectorParam}>
                        <span class={styles.vectorLabel}>{paramMeta.label}</span>
                        <div class={styles.vectorInputs}>
                          <For each={paramMeta.components}>
                            {(component, componentIndex) => (
                              <label class={styles.vectorInput}>
                                <span>{component}</span>
                                <input
                                  type="number"
                                  min={paramMeta.min}
                                  max={paramMeta.max}
                                  step={paramMeta.step}
                                  value={values()[componentIndex()]}
                                  onInput={e => {
                                    const newValues = [...values()] as [number, number, number]
                                    newValues[componentIndex()] = parseFloat(e.target.value)
                                    props.onVideoEffectParamChange(effectIndex(), paramKey, newValues)
                                  }}
                                  onClick={e => e.stopPropagation()}
                                />
                              </label>
                            )}
                          </For>
                        </div>
                      </div>
                    )
                  }}
                </For>
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
