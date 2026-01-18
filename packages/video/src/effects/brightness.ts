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

export interface BrightnessControls {
  value(v: number): void
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
  const schema = compile.toSchema(fragment)

  return {
    fragment,
    apply,
    connect(gl, program, index) {
      const {
        uniforms: { [brightness]: brightnessUniform },
      } = view(gl, program, schema)
      return {
        /** Convert from lexicon scale (-100 to 100) to shader scale (-1 to 1) */
        value(v: number) {
          brightnessUniform[index].set(v / 100)
        },
      }
    },
  }
}
