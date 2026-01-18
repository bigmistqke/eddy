/**
 * Make Effect Manager
 *
 * Manages video effect chain compilation and caching.
 * Separated from compositor to allow simpler compositor that just renders.
 */

import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'
import { compileEffectProgram } from './compile-effect-program'
import type { CompiledEffectChain, EffectManager, EffectRegistry, VideoEffectChain } from './types'

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
 *
 * @param gl - WebGL context
 * @param registry - Effect registry for looking up effect types
 */
export function makeEffectManager(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  registry: EffectRegistry,
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

    registerEffectChain(chain: VideoEffectChain): CompiledEffectChain {
      // Check if already registered
      const existing = chains.get(chain.effectId)
      if (existing) return existing

      // Compile the effect chain
      const result = compileEffectProgram(gl, registry, chain.effectKeys)
      chains.set(chain.effectId, result)

      return result
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
