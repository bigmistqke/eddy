/**
 * Contrast Effect
 *
 * Adjusts the contrast of the video.
 * Range: 0.0 (gray) to 2.0+ (high contrast), default 1.0 (no change)
 */

import { view } from '@bigmistqke/view.gl'
import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'
import type { VideoEffectToken } from './types'

export interface ContrastControls {
  setContrast: (value: number) => void
}

export function makeContrastEffect(): VideoEffectToken<ContrastControls> {
  const contrast = Symbol('contrast')
  const apply = Symbol('applyContrast')

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
      return {
        setContrast: (value: number) => v.uniforms[contrast].set(value),
      }
    },
  }
}
