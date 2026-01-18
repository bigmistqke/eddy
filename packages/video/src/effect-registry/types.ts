/**
 * Effect Registry Types
 */

import type { VideoEffectType } from '../effects/types'

/** A factory function that creates an effect type with a given instance count */
export type EffectFactory<T = any> = (size: number) => VideoEffectType<T>

/** A catalog mapping effect type names to their factory functions */
export type EffectCatalog = Record<string, EffectFactory>

/** An effect registry instance */
export interface EffectRegistry {
  /** Get an effect type by name, creating it with the given size */
  get(type: string, size: number): VideoEffectType | undefined
  /** Check if an effect type is registered */
  has(type: string): boolean
  /** Get all registered effect type names */
  types(): string[]
}
