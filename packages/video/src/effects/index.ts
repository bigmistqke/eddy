export * from './brightness'
export * from './compose-effects'
export * from './contrast'
export * from './saturation'
export * from './types'
export * from './video-effect-registry'

import { registerBrightnessEffect } from './brightness'
import { registerContrastEffect } from './contrast'
import { registerSaturationEffect } from './saturation'

/** Register all built-in video effects with the registry */
export function registerBuiltInVideoEffects(): void {
  registerBrightnessEffect()
  registerContrastEffect()
  registerSaturationEffect()
}
