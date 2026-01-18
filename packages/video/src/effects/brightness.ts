/**
 * Brightness Effect
 *
 * Adjusts the brightness of the video by adding a value to RGB channels.
 * Lexicon value: -100 to 100 (0 = no change)
 * Shader value: -1.0 to 1.0
 */

import { view } from '@bigmistqke/view.gl'
import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'
import type { VideoEffectType } from './types'
import { registerVideoEffectType } from './video-effect-registry'

export interface BrightnessControls {
  setBrightness: (value: number) => void
}

const brightness = Symbol('brightness')
const apply = Symbol('applyBrightness')

/**
 * Create a brightness effect type.
 * Called once per effect type with the total instance count.
 * @param size - Number of instances of this effect in the chain
 */
export function makeBrightnessEffect(size: number): VideoEffectType<BrightnessControls> {
  const fragment = glsl`
    ${uniform.float(brightness, { size })}

    vec4 ${apply}(vec4 color, int index) {
      return vec4(color.rgb + ${brightness}[index], color.a);
    }
  `

  return {
    fragment,
    apply,
    connectInstance(gl, program, instanceIndex, initialValue = 0) {
      const schema = compile.toSchema(fragment)
      console.log('brightness schema:', schema)
      console.log('brightness uniform def:', schema.uniforms[brightness])
      const v = view(gl, program, schema)
      console.log('brightness view.uniforms:', v.uniforms)
      console.log('brightness view.uniforms[brightness]:', v.uniforms[brightness])
      // Convert from lexicon scale (-100 to 100) to shader scale (-1 to 1)
      const setBrightness = (value: number) => v.uniforms[brightness][instanceIndex].set(value / 100)
      // Apply initial value
      setBrightness(initialValue)
      return { setBrightness }
    },
  }
}

/** Register brightness effect type with the registry */
export function registerBrightnessEffect(): void {
  registerVideoEffectType('visual.brightness', makeBrightnessEffect)
}
