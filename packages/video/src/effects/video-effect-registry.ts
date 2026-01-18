/**
 * Video Effect Registry
 *
 * Registry of video effect type factories.
 * Factories take a size parameter (instance count) and return a VideoEffectType.
 */

import type { VideoEffectType } from './types'

/** Registry of video effect type factories by effect type name */
export const VideoEffectTypeRegistry: Record<string, (size: number) => VideoEffectType<any>> = {}

/**
 * Register a video effect type factory.
 * The factory receives size (instance count) and returns a VideoEffectType.
 */
export function registerVideoEffect<T>(
  type: string,
  factory: (size: number) => VideoEffectType<T>,
): void {
  VideoEffectTypeRegistry[type] = factory
}

/**
 * Create a video effect type from a type name and size.
 * Returns undefined if the effect type is not registered.
 */
export function createVideoEffectFromRegistry(
  type: string,
  size: number,
): VideoEffectType | undefined {
  const factory = VideoEffectTypeRegistry[type]
  if (!factory) {
    console.warn(`Unknown video effect type: ${type}`)
    return undefined
  }
  return factory(size)
}
