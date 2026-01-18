export * from './catalog/brightness'
export * from './catalog/contrast'
export * from './catalog/saturation'
export * from './compile-effect-program'
export * from './make-effect-manager'
export * from './types'
export * from './video-effect-registry'

import { registerBrightnessEffect } from './catalog/brightness'
import { registerContrastEffect } from './catalog/contrast'
import { registerSaturationEffect } from './catalog/saturation'

/** Register all built-in video effects with the registry */
export function registerBuiltInVideoEffects(): void {
  registerBrightnessEffect()
  registerContrastEffect()
  registerSaturationEffect()
}
