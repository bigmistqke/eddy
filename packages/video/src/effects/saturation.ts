/**
 * Saturation Effect
 *
 * Adjusts the color saturation of the video.
 * Lexicon value: 0 to 200 (100 = no change, 0 = grayscale)
 * Shader value: 0.0 to 2.0 (1.0 = no change)
 */

import { view } from '@bigmistqke/view.gl'
import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'
import type { VideoEffectType } from './types'

export interface SaturationControls {
  setSaturation: (value: number) => void
}

const saturation = Symbol('saturation')
const apply = Symbol('applySaturation')

/**
 * Create a saturation effect type.
 * Called once per effect type with the total instance count.
 * @param size - Number of instances of this effect in the chain
 */
export function makeSaturationEffect(size: number): VideoEffectType<SaturationControls> {
  const fragment = glsl`
    ${uniform.float(saturation, { size })}

    vec4 ${apply}(vec4 color, int index) {
      float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      return vec4(mix(vec3(gray), color.rgb, ${saturation}[index]), color.a);
    }
  `
  const schema = compile.toSchema(fragment)

  return {
    fragment,
    apply,
    connect(gl, program, index) {
      const {
        uniforms: { [saturation]: setSaturation },
      } = view(gl, program, schema)
      return {
        setSaturation(value: number) {
          setSaturation[index].set(value / 100)
        },
      }
    },
  }
}
