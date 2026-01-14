import type { AudioEffect } from '@eddy/lexicons'
import { debug } from '@eddy/utils'
import { getAudioContext } from './context'
import { getMasterMixer } from './mixer'

const log = debug('audio-pipeline', false)

// Re-export context utilities
export { getAudioContext, resumeAudioContext } from './context'
export { getMasterMixer, type MasterMixer } from './mixer'

/**********************************************************************************/
/*                                                                                */
/*                              Audio Element System                              */
/*                                                                                */
/**********************************************************************************/

/** Result of creating an audio element */
export interface AudioElement {
  /** The audio node to connect in the chain */
  node: AudioNode
  /** Update the element's value (0-1 normalized) */
  setValue: (value: number) => void
}

/** Factory function that creates an audio element from effect params */
export type AudioElementFactory = (ctx: BaseAudioContext, params: { value: number }) => AudioElement

/** Registry of audio element factories by effect type */
const audioElements: Record<string, AudioElementFactory> = {
  'audio.gain': (ctx, params) => {
    const node = ctx.createGain()
    // params.value is 0-100, convert to 0-1
    node.gain.value = params.value / 100
    return {
      node,
      setValue: (value: number) => {
        node.gain.value = value
      },
    }
  },

  'audio.pan': (ctx, params) => {
    const node = ctx.createStereoPanner()
    // params.value is 0-100 (50 = center), convert to -1 to 1
    node.pan.value = (params.value - 50) / 50
    return {
      node,
      setValue: (value: number) => {
        node.pan.value = value
      },
    }
  },
}

/**
 * Register a custom audio element factory.
 * Use for custom effects like EQ, reverb, compression, etc.
 */
export function registerAudioElement(type: string, factory: AudioElementFactory): void {
  audioElements[type] = factory
}

/**********************************************************************************/
/*                                                                                */
/*                              Pipeline Builder                                  */
/*                                                                                */
/**********************************************************************************/

/** Result of building a pipeline - the nodes and control functions */
export interface BuiltPipeline {
  /** First node in the chain (connect source to this) */
  input: AudioNode
  /** Last node in the chain (connect this to destination) */
  output: AudioNode
  /** Map of effect type to its control functions */
  elements: Map<string, AudioElement>
}

/**
 * Build an audio pipeline from lexicon effects.
 * Works with any BaseAudioContext (live or offline).
 * Walks the effects array and creates nodes using registered element factories.
 */
export function buildAudioPipeline(ctx: BaseAudioContext, effects: AudioEffect[]): BuiltPipeline {
  const elements = new Map<string, AudioElement>()
  const nodes: AudioNode[] = []

  for (const effect of effects) {
    const factory = audioElements[effect.type]
    if (!factory) {
      log('unknown effect type, skipping', { type: effect.type })
      continue
    }

    // Extract value from effect (handles StaticValue vs CurveRef)
    // AudioEffectGain and AudioEffectPan have 'value' property
    // AudioEffectCustom has 'params' instead
    let value = 100 // Default
    if ('value' in effect && effect.value && 'value' in effect.value) {
      // StaticValue: { value: number } - values are scaled by 100
      value = effect.value.value
    }
    const params = { value }

    const element = factory(ctx, params)
    elements.set(effect.type, element)
    nodes.push(element.node)

    log('created element', { type: effect.type, params })
  }

  // If no nodes created, create a pass-through gain node
  if (nodes.length === 0) {
    const passthrough = ctx.createGain()
    return {
      input: passthrough,
      output: passthrough,
      elements,
    }
  }

  // Connect nodes in sequence: node[0] -> node[1] -> ... -> node[n]
  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i].connect(nodes[i + 1])
  }

  log('built pipeline', { nodeCount: nodes.length })

  return {
    input: nodes[0],
    output: nodes[nodes.length - 1],
    elements,
  }
}

/**********************************************************************************/
/*                                                                                */
/*                              Live Audio Pipeline                               */
/*                                                                                */
/**********************************************************************************/

export interface AudioPipeline {
  /** The built pipeline with all elements */
  pipeline: BuiltPipeline
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
 * Create a live audio pipeline for playback.
 * Uses the element system to build the pipeline from effects.
 * Connects to master mixer automatically.
 */
export function createAudioPipeline(effects: AudioEffect[]): AudioPipeline {
  const ctx = getAudioContext()
  const mixer = getMasterMixer()

  // Build pipeline from effects using the element system
  const pipeline = buildAudioPipeline(ctx, effects)

  // Connect pipeline output to master mixer
  pipeline.output.connect(mixer.getInputNode())

  let currentSource: MediaElementAudioSourceNode | null = null

  return {
    pipeline,

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
