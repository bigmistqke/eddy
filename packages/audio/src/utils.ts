import { registerAudioElement, type AudioElementFactory } from './audio-element-registry'

const registered = new Set<string>()

/**
 * Register an audio element factory only once.
 * Returns a registration function that can be called multiple times safely.
 */
export function makeAudioElementRegistration(
  type: string,
  factory: AudioElementFactory,
): () => void {
  return () => {
    if (registered.has(type)) return
    registered.add(type)
    registerAudioElement(type, factory)
  }
}
