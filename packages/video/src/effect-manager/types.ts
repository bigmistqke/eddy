/**
 * Effect Manager Types
 */

import type { EffectControls, VideoEffectType } from '../effects'

/** An effect instance - just the effect type name (e.g., 'visual.brightness') */
export type EffectKey = string

/**
 * A named effect chain - a sequence of effect instances that compiles to one shader.
 * Multiple clips can reference the same chain by id.
 */
export interface VideoEffectChain {
  /** Unique identifier for this chain */
  effectId: string
  /** Effect type names to apply in sequence */
  effectKeys: EffectKey[]
}

/**
 * A compiled effect chain ready for rendering.
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
  registerEffectChain(chain: VideoEffectChain): CompiledEffectChain
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

/**********************************************************************************/
/*                                                                                */
/*                              Effect Registry Types                             */
/*                                                                                */
/**********************************************************************************/

/** A factory function that creates an effect type with a given instance count */
export type EffectFactory<T = any> = (size: number) => VideoEffectType<T>

/** A catalog mapping effect type names to their factory functions */
export type EffectCatalog = Record<string, EffectFactory>

/** An effect registry instance */
export interface EffectRegistry {
  /** Get an effect type by name, creating it with the given size */
  get(type: string, size: number): VideoEffectType | undefined
  /** Check if an effect type is registered */
  has(type: string): boolean
  /** Get all registered effect type names */
  types(): string[]
}
