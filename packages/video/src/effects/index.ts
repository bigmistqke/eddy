export * from './brightness'
export * from './contrast'
export * from './saturation'
export * from './types'

import { makeBrightnessEffect } from './brightness'
import { makeContrastEffect } from './contrast'
import { makeSaturationEffect } from './saturation'

/** Map of effect type names to factory functions */
export const effectCatalog = {
  'visual.brightness': makeBrightnessEffect,
  'visual.contrast': makeContrastEffect,
  'visual.saturation': makeSaturationEffect,
} as const
