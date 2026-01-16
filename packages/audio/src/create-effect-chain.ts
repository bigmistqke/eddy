import type { AudioEffect } from '@eddy/lexicons'
import { debug } from '@eddy/utils'
import { audioElements, type AudioElement } from './audio-elements'

const log = debug('effect-chain', false)

/** Result of building effect nodes - the chain and control functions */
export interface EffectChain {
  /** First node in the chain (connect source to this) */
  input: AudioNode
  /** Last node in the chain (connect this to destination) */
  output: AudioNode
  /** Map of effect type to its control functions */
  elements: Map<string, AudioElement>
}

/**********************************************************************************/
/*                                                                                */
/*                               Create Effect Chain                              */
/*                                                                                */
/**********************************************************************************/

/**
 * Build effect nodes from lexicon effects.
 * Works with any BaseAudioContext (live or offline).
 * Walks the effects array and creates nodes using registered element factories.
 */
export function createEffectChain(ctx: BaseAudioContext, effects: AudioEffect[]): EffectChain {
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
