import type { AudioEffect, StaticValue } from '@eddy/lexicons'
import { debug } from '@eddy/utils'
import {
  AudioElementRegistry,
  type AudioElement,
  type AudioElementParams,
} from './audio-element-registry'

const log = debug('audio:make-effect-chain', false)

/** Result of building effect nodes - the chain and control functions */
export interface EffectChain {
  /** First node in the chain (connect source to this) */
  input: AudioNode
  /** Last node in the chain (connect this to destination) */
  output: AudioNode
  /** Map of effect type to its control functions */
  elements: Map<string, AudioElement>
  /** Dispose all elements */
  dispose: () => void
}

/**********************************************************************************/
/*                                                                                */
/*                                     Utils                                      */
/*                                                                                */
/**********************************************************************************/

/** Check if value is a StaticValue (has 'value' property) */
function isStaticValue(value: unknown): value is StaticValue {
  return typeof value === 'object' && value !== null && 'value' in value
}

/** Extract numeric value from StaticValue or CurveRef, defaulting to provided default */
function extractValue(value: unknown, defaultValue: number): number {
  if (isStaticValue(value)) {
    return value.value
  }
  // CurveRef - for now return default (TODO: implement curve evaluation)
  return defaultValue
}

/** Extract all params from an effect definition */
function extractParams(effect: AudioEffect): AudioElementParams {
  const params: AudioElementParams = {}

  // Extract values from params object (all effects now use params pattern)
  if ('params' in effect && typeof effect.params === 'object' && effect.params !== null) {
    for (const [key, value] of Object.entries(effect.params)) {
      params[key] = extractValue(value, 0)
    }
  }

  return params
}

/**********************************************************************************/
/*                                                                                */
/*                                Make Effect Chain                               */
/*                                                                                */
/**********************************************************************************/

/**
 * Build effect nodes from lexicon effects.
 * Works with any BaseAudioContext (live or offline).
 * Walks the effects array and creates nodes using registered element factories.
 */
export function makeEffectChain(ctx: BaseAudioContext, effects: AudioEffect[]): EffectChain {
  const elements = new Map<string, AudioElement>()
  const nodeSequence: { input: AudioNode; output: AudioNode }[] = []

  for (const effect of effects) {
    const factory = AudioElementRegistry[effect.type]
    if (!factory) {
      log('unknown effect type, skipping', { type: effect.type })
      continue
    }

    const params = extractParams(effect)
    const element = factory(ctx, params)
    elements.set(effect.type, element)
    nodeSequence.push({
      input: element.node,
      output: element.output ?? element.node,
    })

    log('created element', { type: effect.type, params })
  }

  // If no nodes created, create a pass-through gain node
  if (nodeSequence.length === 0) {
    const passthrough = ctx.createGain()
    return {
      input: passthrough,
      output: passthrough,
      elements,
      dispose: () => {},
    }
  }

  // Connect nodes in sequence: output[0] -> input[1] -> ... -> output[n]
  for (let i = 0; i < nodeSequence.length - 1; i++) {
    nodeSequence[i].output.connect(nodeSequence[i + 1].input)
  }

  log('built pipeline', { nodeCount: nodeSequence.length })

  return {
    input: nodeSequence[0].input,
    output: nodeSequence[nodeSequence.length - 1].output,
    elements,
    dispose: () => {
      for (const element of elements.values()) {
        element.dispose?.()
      }
    },
  }
}
