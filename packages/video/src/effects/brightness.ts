/**
 * Brightness Effect
 *
 * Adjusts the brightness of the video by adding a value to RGB channels.
 * Range: -1.0 (black) to 1.0 (white), default 0.0 (no change)
 */

import { view } from '@bigmistqke/view.gl'
import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'
import type { VideoEffectToken } from './types'

export interface BrightnessControls {
  setBrightness: (value: number) => void
}

export function makeBrightnessEffect(): VideoEffectToken<BrightnessControls> {
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
      return {
        setBrightness: (value: number) => v.uniforms[brightness].set(value),
      }
    },
  }
}
