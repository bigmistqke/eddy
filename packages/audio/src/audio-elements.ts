/** Result of creating an audio element */
export interface AudioElement {
  /** The audio node to connect in the chain */
  node: AudioNode
  /** Update the element's value (0-1 normalized) */
  setValue: (value: number) => void
}

/** Factory function that creates an audio element from effect params */
export type AudioElementFactory = (ctx: BaseAudioContext, params: { value: number }) => AudioElement

/** Registry of audio element factories by effect type */
export const audioElements: Record<string, AudioElementFactory> = {
  'audio.gain': (ctx, params) => {
    const node = ctx.createGain()
    // params.value is 0-100, convert to 0-1
    node.gain.value = params.value / 100
    return {
      node,
      setValue: (value: number) => {
        node.gain.value = value
      },
    }
  },

  'audio.pan': (ctx, params) => {
    const node = ctx.createStereoPanner()
    // params.value is 0-100 (50 = center), convert to -1 to 1
    node.pan.value = (params.value - 50) / 50
    return {
      node,
      setValue: (value: number) => {
        node.pan.value = value
      },
    }
  },
}

/**
 * Register a custom audio element factory.
 * Use for custom effects like EQ, reverb, compression, etc.
 */
export function registerAudioElement(type: string, factory: AudioElementFactory): void {
  audioElements[type] = factory
}
