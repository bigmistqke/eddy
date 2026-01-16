import type { AudioEffect } from '@eddy/lexicons'
import { getAudioContext } from './context'
import { type EffectChain, createEffectChain } from './create-effect-chain'
import { getMasterMixer } from './mixer'

export interface AudioBus {
  /** The effect chain with all elements */
  effectChain: EffectChain
  /** Set volume (0-1) - updates audio.gain element if present */
  setVolume: (value: number) => void
  /** Set pan (-1 to 1) - updates audio.pan element if present */
  setPan: (value: number) => void
  /** Connect an HTML media element as source */
  connect: (element: HTMLMediaElement) => void
  /** Disconnect current source */
  disconnect: () => void
}

// Track elements that have been connected (can only create one source per element ever)
const connectedElements = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()

/**
 * Create an audio bus for live playback.
 * Uses the element system to build effect nodes from effects.
 * Connects to master mixer automatically.
 */
export function createAudioBus(effects: AudioEffect[]): AudioBus {
  const ctx = getAudioContext()
  const mixer = getMasterMixer()

  // Build effect nodes using the element system
  const pipeline = createEffectChain(ctx, effects)

  // Connect pipeline output to master mixer
  pipeline.output.connect(mixer.getInputNode())

  let currentSource: MediaElementAudioSourceNode | null = null

  return {
    effectChain: pipeline,

    setVolume(value: number) {
      // value: 0-1
      const gainElement = pipeline.elements.get('audio.gain')
      if (gainElement) {
        gainElement.setValue(value)
      }
    },

    setPan(value: number) {
      // value: -1 (left) to 1 (right)
      const panElement = pipeline.elements.get('audio.pan')
      if (panElement) {
        panElement.setValue(value)
      }
    },

    connect(element: HTMLMediaElement) {
      // Disconnect current source from our pipeline
      if (currentSource) {
        currentSource.disconnect()
      }

      // Check if element already has a source node (can only create once per element)
      let source = connectedElements.get(element)
      if (!source) {
        source = ctx.createMediaElementSource(element)
        connectedElements.set(element, source)
      }

      source.connect(pipeline.input)
      currentSource = source
    },

    disconnect() {
      if (currentSource) {
        currentSource.disconnect()
        currentSource = null
      }
    },
  }
}
