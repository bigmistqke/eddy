/**
 * Audio Effects
 *
 * Built-in audio effects for the effect chain.
 */

import { registerGainElement } from './gain'
import { registerPanElement } from './pan'
import { registerReverbElement } from './reverb'

export { registerGainElement, registerPanElement, registerReverbElement }

/** Register all built-in effects (idempotent) */
export function registerBuiltInAudioEffects(): void {
  registerGainElement()
  registerPanElement()
  registerReverbElement()
}
