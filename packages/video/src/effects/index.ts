export * from './types'
export * from './compose-effects'
export * from './make-effect-chain-cache'
export * from './video-effect-registry'
export * from './brightness'
export * from './contrast'
export * from './saturation'

import { registerBrightnessEffect } from './brightness'
import { registerContrastEffect } from './contrast'
import { registerSaturationEffect } from './saturation'

/** Register all built-in video effects with the registry */
export function registerBuiltInVideoEffects(): void {
  registerBrightnessEffect()
  registerContrastEffect()
  registerSaturationEffect()
}
