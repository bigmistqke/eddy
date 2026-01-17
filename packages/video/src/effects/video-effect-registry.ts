/**
 * Video Effect Registry
 *
 * Registry of video effect factories by type.
 * Similar to AudioElementRegistry but for shader-based video effects.
 */

import type { VideoEffectFactory, VideoEffectToken } from './types'

/** Parameters passed to video effect factory - all values are 0-100 scaled */
export type VideoEffectParams = Record<string, number>

/** Factory that creates a VideoEffectToken with initial params */
export type VideoEffectRegistryFactory = (params: VideoEffectParams) => VideoEffectToken<any>

/** Registry of video effect factories by effect type */
export const VideoEffectRegistry: Record<string, VideoEffectRegistryFactory> = {}

/**
 * Register a video effect factory.
 * The factory receives initial params (0-100 scaled) and returns a VideoEffectToken.
 */
export function registerVideoEffect(type: string, factory: VideoEffectRegistryFactory): void {
  VideoEffectRegistry[type] = factory
}

/**
 * Create a video effect token from a type and params.
 * Returns undefined if the effect type is not registered.
 */
export function createVideoEffect(type: string, params: VideoEffectParams): VideoEffectToken | undefined {
  const factory = VideoEffectRegistry[type]
  if (!factory) {
    console.warn(`Unknown video effect type: ${type}`)
    return undefined
  }
  return factory(params)
}
