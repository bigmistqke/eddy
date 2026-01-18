/**
 * Contrast Effect
 *
 * Adjusts the contrast of the video.
 * Lexicon value: 0 to 200 (100 = no change)
 * Shader value: 0.0 to 2.0 (1.0 = no change)
 */

import { view } from '@bigmistqke/view.gl'
import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'
import type { VideoEffectType } from '../types'
import { registerVideoEffect } from '../video-effect-registry'

export interface ContrastControls {
  setContrast: (value: number) => void
}

const contrast = Symbol('contrast')
const apply = Symbol('applyContrast')

/**
 * Create a contrast effect type.
 * Called once per effect type with the total instance count.
 * @param size - Number of instances of this effect in the chain
 */
export function makeContrastEffect(size: number): VideoEffectType<ContrastControls> {
  const fragment = glsl`
    ${uniform.float(contrast, { size })}

    vec4 ${apply}(vec4 color, int index) {
      return vec4((color.rgb - 0.5) * ${contrast}[index] + 0.5, color.a);
    }
  `
  const schema = compile.toSchema(fragment)

  return {
    fragment,
    apply,
    connect(gl, program, index) {
      const {
        uniforms: { [contrast]: set },
      } = view(gl, program, schema)

      // Convert from lexicon scale (0-200) to shader scale (0-2)
      const setContrast = (value: number) => set[index].set(value / 100)

      return { setContrast }
    },
  }
}

export const registerContrastEffect = () =>
  registerVideoEffect('visual.contrast', makeContrastEffect)
