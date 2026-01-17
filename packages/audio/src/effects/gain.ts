/**
 * Gain Audio Effect
 *
 * Simple volume control.
 */

import type { AudioElement, AudioElementParams } from '../audio-element-registry'
import { makeAudioElementRegistration } from '../utils'

/**
 * Create a gain audio element.
 *
 * Params:
 * - value: volume level (0-100, where 100 = unity gain)
 */
function makeGainElement(ctx: BaseAudioContext, params: AudioElementParams): AudioElement {
  const node = ctx.createGain()
  // params.value is 0-100, convert to 0-1
  node.gain.value = (params.value ?? 100) / 100

  return {
    node,
    setParam: (name, value) => {
      if (name === 'value') {
        node.gain.value = value
      }
    },
  }
}

/** Register the gain effect (idempotent) */
export const registerGainElement = makeAudioElementRegistration('audio.gain', makeGainElement)
