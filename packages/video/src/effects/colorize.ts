/**
 * Colorize Effect
 *
 * Applies a color overlay/tint to the video.
 * Has two params: color (vec3) and intensity (scalar).
 * Lexicon value: Each component 0-100 (representing 0.0-1.0)
 * Shader value: 0.0-1.0
 */

import { view } from '@bigmistqke/view.gl'
import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'
import type { EffectValue, VideoEffectType } from './types'

export interface ColorizeControls {
  /** Tint color as vec3, each component 0-100 */
  color(value: [number, number, number]): void
  /** Intensity 0-100 */
  intensity(value: number): void
}

const colorSym = Symbol('color')
const intensitySym = Symbol('intensity')
const apply = Symbol('applyColorize')

/**
 * Create a colorize effect type.
 * Called once per effect type with the total instance count.
 * @param size - Number of instances of this effect in the chain
 */
export function makeColorizeEffect(size: number): VideoEffectType<ColorizeControls> {
  const fragment = glsl`
    ${uniform.vec3(colorSym, { size })}
    ${uniform.float(intensitySym, { size })}

    vec4 ${apply}(vec4 color, int index) {
      vec3 tintColor = ${colorSym}[index];
      float intensity = ${intensitySym}[index];

      // Mix original color with tinted version based on intensity
      vec3 tinted = mix(color.rgb, color.rgb * tintColor, intensity);
      return vec4(tinted, color.a);
    }
  `
  const schema = compile.toSchema(fragment)

  return {
    fragment,
    apply,
    connect(gl, program, index) {
      const {
        uniforms: { [colorSym]: setColorUniform, [intensitySym]: setIntensityUniform },
      } = view(gl, program, schema)
      return {
        /** Convert from lexicon scale (0-100 per component) to shader scale (0.0-1.0) */
        color(value: EffectValue) {
          const [r, g, b] = value as [number, number, number]
          setColorUniform[index].set(r / 100, g / 100, b / 100)
        },
        /** Convert from lexicon scale (0-100) to shader scale (0.0-1.0) */
        intensity(value: EffectValue) {
          setIntensityUniform[index].set((value as number) / 100)
        },
      }
    },
  }
}
