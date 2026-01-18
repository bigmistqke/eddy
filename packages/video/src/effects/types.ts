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
 * A composable video effect token (legacy - single instance).
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
  connectInstance(
    gl: WebGL2RenderingContext | WebGLRenderingContext,
    program: WebGLProgram,
    instanceIndex: number,
    initialValue?: number,
  ): TControls
}

/** Factory function that creates a video effect type with given size */
export type VideoEffectTypeFactory<TControls = EffectControls> = (size: number) => VideoEffectType<TControls>

/**********************************************************************************/
/*                                                                                */
/*                                  Effect Chains                                 */
/*                                                                                */
/**********************************************************************************/

/** An effect instance in a chain */
export interface EffectInstance {
  /** Effect type name (e.g., 'visual.brightness') */
  type: string
  /** Initial value for this instance */
  initialValue?: number
}

/**
 * A named effect chain - a sequence of effect instances that compiles to one shader.
 * Multiple clips can reference the same chain by id.
 */
export interface VideoEffectChain {
  /** Unique identifier for this chain */
  id: string
  /** Effect instances to apply in sequence */
  effects: EffectInstance[]
}

/**
 * A compiled effect chain ready for rendering.
 * Created by composeEffectTypes() and cached by the compositor.
 */
export interface CompiledEffectChain {
  /** The compiled WebGL program */
  program: WebGLProgram
  /** View for base uniforms (u_video texture) */
  view: {
    uniforms: {
      u_video: { set(value: number): void }
    }
    attributes: {
      a_quad: { bind(): void }
    }
  }
  /** Controls for each effect instance in the chain, in order */
  controls: EffectControls[]
}

/**
 * Manages compiled effect chains.
 * Caches compiled shaders by chain id for reuse across clips.
 */
export interface EffectChainCache {
  /** Get or compile a chain */
  get(chain: VideoEffectChain): CompiledEffectChain
  /** Get a chain by id (must already be compiled) */
  getById(id: string): CompiledEffectChain | undefined
  /** Check if a chain is compiled */
  has(id: string): boolean
  /** Delete a compiled chain */
  delete(id: string): void
  /** Clear all compiled chains */
  clear(): void
}
