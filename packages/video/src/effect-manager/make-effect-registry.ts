/**
 * Make Effect Registry
 *
 * Factory for creating effect registries from a catalog of effect factories.
 * Registries are explicit instances passed to compilers/managers - no globals.
 */

import type { VideoEffectType } from '../effects/types'
import type { EffectCatalog, EffectRegistry } from './types'

/**
 * Create an effect registry from a catalog of effect factories.
 *
 * @param catalog - Map of effect type names to factory functions
 * @returns An effect registry instance
 *
 * @example
 * ```ts
 * const registry = makeEffectRegistry({
 *   'visual.brightness': makeBrightnessEffect,
 *   'visual.contrast': makeContrastEffect,
 * })
 *
 * const effect = registry.get('visual.brightness', 2)
 * ```
 */
export function makeEffectRegistry(catalog: EffectCatalog): EffectRegistry {
  return {
    get(type: string, size: number): VideoEffectType | undefined {
      const factory = catalog[type]
      if (!factory) {
        console.warn(`Unknown video effect type: ${type}`)
        return undefined
      }
      return factory(size)
    },

    has(type: string): boolean {
      return type in catalog
    },

    types(): string[] {
      return Object.keys(catalog)
    },
  }
}
