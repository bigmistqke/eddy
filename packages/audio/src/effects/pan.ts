/**
 * Pan Audio Effect
 *
 * Stereo panning control.
 */

import type { AudioElement, AudioElementParams } from '../audio-element-registry'
import { makeAudioElementRegistration } from '../utils'

/**
 * Create a pan audio element.
 *
 * Params:
 * - value: pan position (0-100, where 50 = center, 0 = left, 100 = right)
 */
function makePanElement(ctx: BaseAudioContext, params: AudioElementParams): AudioElement {
  const node = ctx.createStereoPanner()
  // params.value is 0-100 (50 = center), convert to -1 to 1
  node.pan.value = ((params.value ?? 50) - 50) / 50

  return {
    node,
    setParam: (name, value) => {
      if (name === 'value') {
        // value is -1 to 1
        node.pan.value = value
      }
    },
  }
}

/** Register the pan effect (idempotent) */
export const registerPanElement = makeAudioElementRegistration('audio.pan', makePanElement)
