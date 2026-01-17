/**
 * Brightness Effect
 *
 * Adjusts the brightness of the video by adding a value to RGB channels.
 * Lexicon value: -100 to 100 (0 = no change)
 * Shader value: -1.0 to 1.0
 */

import { view } from '@bigmistqke/view.gl'
import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'
import type { VideoEffectToken } from './types'
import { registerVideoEffect, type VideoEffectParams } from './video-effect-registry'

export interface BrightnessControls {
  setBrightness: (value: number) => void
}

/**
 * Create a brightness effect.
 * @param initialValue - Initial brightness (-100 to 100, default 0)
 */
export function makeBrightnessEffect(initialValue = 0): VideoEffectToken<BrightnessControls> {
  const brightness = Symbol('brightness')
  const apply = Symbol('applyBrightness')

  const fragment = glsl`
    ${uniform.float(brightness)}

    vec4 ${apply}(vec4 color) {
      return vec4(color.rgb + ${brightness}, color.a);
    }
  `

  return {
    fragment,
    apply,
    connect(gl, program) {
      const v = view(gl, program, compile.toSchema(fragment))
      // Convert from lexicon scale (-100 to 100) to shader scale (-1 to 1)
      const setBrightness = (value: number) => v.uniforms[brightness].set(value / 100)
      // Apply initial value
      setBrightness(initialValue)
      return { setBrightness }
    },
  }
}

/** Register brightness effect with the video effect registry */
export function registerBrightnessEffect(): void {
  registerVideoEffect('visual.brightness', (params: VideoEffectParams) => {
    return makeBrightnessEffect(params.value ?? 0)
  })
}
