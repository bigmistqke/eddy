/**
 * Saturation Effect
 *
 * Adjusts the color saturation of the video.
 * Lexicon value: 0 to 200 (100 = no change, 0 = grayscale)
 * Shader value: 0.0 to 2.0 (1.0 = no change)
 */

import { view } from '@bigmistqke/view.gl'
import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'
import type { VideoEffectToken } from './types'
import { registerVideoEffect, type VideoEffectParams } from './video-effect-registry'

export interface SaturationControls {
  setSaturation: (value: number) => void
}

const saturation = Symbol('saturation')
const apply = Symbol('applySaturation')

/**
 * Create a saturation effect.
 * @param initialValue - Initial saturation (0 to 200, default 100 = no change)
 */
export function makeSaturationEffect(initialValue = 100): VideoEffectToken<SaturationControls> {
  const fragment = glsl`
    ${uniform.float(saturation)}

    vec4 ${apply}(vec4 color) {
      float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
      return vec4(mix(vec3(gray), color.rgb, ${saturation}), color.a);
    }
  `

  return {
    fragment,
    apply,
    connect(gl, program) {
      const v = view(gl, program, compile.toSchema(fragment))
      // Convert from lexicon scale (0-200) to shader scale (0-2)
      const setSaturation = (value: number) => v.uniforms[saturation].set(value / 100)
      // Apply initial value
      setSaturation(initialValue)
      return { setSaturation }
    },
  }
}

/** Register saturation effect with the video effect registry */
export function registerSaturationEffect(): void {
  registerVideoEffect('visual.saturation', (params: VideoEffectParams) => {
    return makeSaturationEffect(params.value ?? 100)
  })
}
