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
 * A video effect type with deduplication support.
 *
 * When the same effect type appears multiple times in a chain:
 * 1. Fragment is included once (with array uniform of size N)
 * 2. Function takes int index parameter for array access (WebGL2 only)
 * 3. Each instance calls the function with its index
 * 4. connectInstance creates controls for a specific instance
 */
export interface VideoEffectType<TControls = EffectControls> {
  /** GLSL fragment containing array uniform and apply function */
  fragment: GLSL
  /** Symbol for the apply function: vec4 ${apply}(vec4 color, int index) */
  apply: symbol
  /** Connect a specific instance to the compiled program */
  connect(
    gl: WebGL2RenderingContext | WebGLRenderingContext,
    program: WebGLProgram,
    instanceIndex: number,
    initialValues?: Record<string, number>,
  ): TControls
}

/** An effect instance in a chain */
export interface EffectInstance {
  /** Effect type name (e.g., 'visual.brightness') */
  type: string
  /** Initial values for this instance's uniforms */
  initialValues?: Record<string, number>
}
