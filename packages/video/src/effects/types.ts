/**
 * Video Effect Types
 *
 * Composable video effects using view.gl's Symbol-based GLSL composition.
 * Effects define GLSL fragments with uniforms, then receive the compiled
 * program to get typed setters via compile.toSchema().
 */

import type { GLSL } from '@bigmistqke/view.gl'

/** Controls returned by an effect after binding to a compiled program */
export type EffectControls = Record<string, (value: number) => void>

/**
 * A composable video effect token.
 *
 * The "snake eating its tail" pattern:
 * 1. Effect defines GLSL fragment with uniform declarations
 * 2. Compositor concatenates all fragments and compiles
 * 3. Program is passed back to effect's connect()
 * 4. Effect uses compile.toSchema(fragment) to extract schema
 * 5. Effect calls view(gl, program, schema) to get typed setters
 */
export interface VideoEffectToken<TControls = EffectControls> {
  /** GLSL fragment containing uniforms and the apply function */
  fragment: GLSL
  /** Symbol for the apply function: vec4 ${apply}(vec4 color) */
  apply: symbol
  /** Connect to compiled program and return typed controls */
  connect(gl: WebGL2RenderingContext | WebGLRenderingContext, program: WebGLProgram): TControls
}

/** Factory function that creates a video effect token */
export type VideoEffectFactory<TControls = EffectControls> = () => VideoEffectToken<TControls>
