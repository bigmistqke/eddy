/**
 * Make Effect Manager
 *
 * Manages video effect chain compilation and caching.
 * Separated from compositor to allow simpler compositor that just renders.
 */

import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'
import { compileEffectProgram } from './compile-effect-program'
import type { EffectControls, EffectInstance } from './types'

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

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

/**********************************************************************************/
/*                                                                                */
/*                               Make Effect Manager                              */
/*                                                                                */
/**********************************************************************************/

// Passthrough shader - samples a single texture per quad (no effects)
const passthroughFragment = glsl`
  precision mediump float;

  ${uniform.sampler2D('u_video')}

  varying vec2 v_uv;

  void main() {
    vec2 uv = v_uv * 0.5 + 0.5;
    uv.y = 1.0 - uv.y; // Flip Y for video
    gl_FragColor = texture2D(u_video, uv);
  }
`

/**
 * Create an effect manager for a WebGL context.
 * Handles effect chain compilation, caching, and program activation.
 */
export function makeEffectManager(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
): EffectManager {
  const chains = new Map<string, CompiledEffectChain>()

  // Compile passthrough shader (no effects)
  const passthroughCompiled = compile.toQuad(gl, passthroughFragment)
  const passthrough: CompiledEffectChain = {
    program: passthroughCompiled.program,
    view: passthroughCompiled.view as CompiledEffectChain['view'],
    controls: [],
  }

  return {
    passthrough,

    register(chain: VideoEffectChain): CompiledEffectChain {
      // Check if already registered
      const existing = chains.get(chain.id)
      if (existing) return existing

      // Compile the effect chain
      const result = compileEffectProgram(gl, chain.effects)
      const compiled: CompiledEffectChain = {
        program: result.program,
        view: result.view,
        controls: result.controls,
      }
      chains.set(chain.id, compiled)

      return compiled
    },

    has(id: string): boolean {
      return chains.has(id)
    },

    get(id: string): CompiledEffectChain | undefined {
      return chains.get(id)
    },

    delete(id: string): void {
      const chain = chains.get(id)
      if (chain) {
        gl.deleteProgram(chain.program)
        chains.delete(id)
      }
    },

    activate(chain: CompiledEffectChain): void {
      gl.useProgram(chain.program)
    },

    destroy(): void {
      for (const chain of chains.values()) {
        gl.deleteProgram(chain.program)
      }
      chains.clear()
      // Note: passthrough program owned by caller if needed
    },
  }
}
