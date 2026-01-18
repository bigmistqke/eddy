/**
 * Compose Effects
 *
 * Composes multiple video effects into a single fragment shader.
 * Handles the "snake eating its tail" pattern:
 * 1. Collect all effect GLSL fragments
 * 2. Build main() that chains apply() calls
 * 3. Compile to program
 * 4. Pass program back to each effect's connect()
 */

import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'
import type { VideoEffectToken } from './types'

/** Result of composing effects */
export interface ComposedEffects<TEffects extends VideoEffectToken[]> {
  /** The compiled WebGL program */
  program: WebGLProgram
  /** Controls for each effect, keyed by index */
  controls: { [K in keyof TEffects]: TEffects[K] extends VideoEffectToken<infer C> ? C : never }
  /** View for the base uniforms (u_video) */
  view: {
    uniforms: {
      u_video: { set(value: number): void }
    }
    attributes: {
      a_quad: { bind(): void }
    }
  }
}

/**
 * Compose multiple video effects into a single shader program.
 *
 * @param gl - WebGL context
 * @param effects - Array of effect tokens to compose
 * @returns Compiled program and controls for each effect
 */
export function composeEffects<TEffects extends VideoEffectToken[]>(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  effects: TEffects,
): ComposedEffects<TEffects> {
  // Build the effect chain in main()
  // Start: color = texture2D(u_video, uv)
  // Each effect: color = ${effect.apply}(color)
  // End: gl_FragColor = color

  const effectChain =
    effects.length > 0
      ? effects.map(effect => glsl`color = ${effect.apply}(color);`)
      : [glsl`/* no effects */`]

  const fragmentShader = glsl`
    precision mediump float;

    ${uniform.sampler2D('u_video')}
    ${effects.map(effect => effect.fragment)}

    varying vec2 v_uv;

    void main() {
      vec2 uv = v_uv * 0.5 + 0.5;
      uv.y = 1.0 - uv.y;
      vec4 color = texture2D(u_video, uv);
      ${effectChain}
      gl_FragColor = color;
    }
  `

  const compiled = compile.toQuad(gl, fragmentShader)
  const program = compiled.program

  // Activate program before setting initial uniform values
  gl.useProgram(program)

  // Connect each effect to get its controls
  const controls = effects.map(effect =>
    effect.connect(gl, program),
  ) as ComposedEffects<TEffects>['controls']

  return {
    program,
    controls,
    view: compiled.view as ComposedEffects<TEffects>['view'],
  }
}
