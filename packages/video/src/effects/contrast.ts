/**
 * Contrast Effect
 *
 * Adjusts the contrast of the video.
 * Lexicon value: 0 to 200 (100 = no change)
 * Shader value: 0.0 to 2.0 (1.0 = no change)
 */

import { view } from '@bigmistqke/view.gl'
import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'
import type { VideoEffectToken } from './types'
import { registerVideoEffect, type VideoEffectParams } from './video-effect-registry'

export interface ContrastControls {
  setContrast: (value: number) => void
}

const contrast = Symbol('contrast')
const apply = Symbol('applyContrast')

/**
 * Create a contrast effect.
 * @param initialValue - Initial contrast (0 to 200, default 100 = no change)
 */
export function makeContrastEffect(initialValue = 100): VideoEffectToken<ContrastControls> {
  const fragment = glsl`
    ${uniform.float(contrast)}

    vec4 ${apply}(vec4 color) {
      return vec4((color.rgb - 0.5) * ${contrast} + 0.5, color.a);
    }
  `

  return {
    fragment,
    apply,
    connect(gl, program) {
      const v = view(gl, program, compile.toSchema(fragment))
      // Convert from lexicon scale (0-200) to shader scale (0-2)
      const setContrast = (value: number) => v.uniforms[contrast].set(value / 100)
      // Apply initial value
      setContrast(initialValue)
      return { setContrast }
    },
  }
}

/** Register contrast effect with the video effect registry */
export function registerContrastEffect(): void {
  registerVideoEffect('visual.contrast', (params: VideoEffectParams) => {
    return makeContrastEffect(params.value ?? 100)
  })
}
