/** Result of creating an audio element */
export interface AudioElement {
  /** The audio node to connect in the chain (input of the effect graph) */
  node: AudioNode
  /** Output node if different from input (for multi-node effects like reverb) */
  output?: AudioNode
  /** Update a parameter by name */
  setParam: (name: string, value: number) => void
  /** Dispose of any resources (e.g., impulse response buffers) */
  dispose?: () => void
}

/** Parameters passed to audio element factory - all values are 0-100 scaled */
export type AudioElementParams = Record<string, number>

/** Factory function that creates an audio element from effect params */
export type AudioElementFactory = (ctx: BaseAudioContext, params: AudioElementParams) => AudioElement

/** Registry of audio element factories by effect type */
export const AudioElementRegistry: Record<string, AudioElementFactory> = {}

/**
 * Register a custom audio element factory.
 * Use for custom effects like EQ, reverb, compression, etc.
 */
export function registerAudioElement(type: string, factory: AudioElementFactory): void {
  AudioElementRegistry[type] = factory
}
