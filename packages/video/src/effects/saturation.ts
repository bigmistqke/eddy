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
import { registerVideoEffectType } from './video-effect-registry'

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

  return {
    fragment,
    apply,
    connectInstance(gl, program, instanceIndex, initialValue = 100) {
      const v = view(gl, program, compile.toSchema(fragment))
      // Convert from lexicon scale (0-200) to shader scale (0-2)
      const setSaturation = (value: number) => v.uniforms[saturation][instanceIndex].set(value / 100)
      // Apply initial value
      setSaturation(initialValue)
      return { setSaturation }
    },
  }
}

/** Register saturation effect type with the registry */
export function registerSaturationEffect(): void {
  registerVideoEffectType('visual.saturation', makeSaturationEffect)
}
