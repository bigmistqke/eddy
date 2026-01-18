/**
 * Effect Manager Types
 */

import type { EffectControls } from '../effects'

/** An effect instance in a chain */
export interface EffectInstance {
  /** Effect type name (e.g., 'visual.brightness') */
  type: string
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
 * Created by composeEffectTypes() and cached by the manager.
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

export interface EffectManager {
  /** The passthrough chain (no effects) */
  readonly passthrough: CompiledEffectChain
  /**
   * Register an effect chain. Compiles the shader and caches it.
   * @returns The compiled effect chain
   */
  register(chain: VideoEffectChain): CompiledEffectChain
  /** Check if an effect chain is registered */
  has(id: string): boolean
  /** Get a registered effect chain */
  get(id: string): CompiledEffectChain | undefined
  /** Remove an effect chain */
  delete(id: string): void
  /** Activate an effect chain (bind its program) */
  activate(chain: CompiledEffectChain): void
  /** Clean up all resources */
  destroy(): void
}

/** Result of composing effect types */
export interface EffectProgram<T extends EffectControls = EffectControls> {
  /** The compiled WebGL program */
  program: WebGLProgram
  /** Controls for each effect instance, in order */
  controls: T[]
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
