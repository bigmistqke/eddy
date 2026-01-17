/**
 * Effect Chain Cache
 *
 * Manages compiled video effect chains. Each unique chain compiles to one shader
 * program, which is cached for reuse across multiple clips.
 */

import { composeEffects } from './compose-effects'
import type { CompiledEffectChain, EffectChainCache, VideoEffectChain } from './types'

/**
 * Create an effect chain cache for a WebGL context.
 *
 * Usage:
 * ```ts
 * const cache = makeEffectChainCache(gl)
 *
 * // Define chains
 * const colorGrade: VideoEffectChain = {
 *   id: 'color-grade',
 *   effects: [makeBrightnessEffect(), makeContrastEffect()]
 * }
 *
 * // Get compiled chain (compiles on first access, cached after)
 * const compiled = cache.get(colorGrade)
 *
 * // Use controls
 * compiled.controls[0].setBrightness(0.1)
 * compiled.controls[1].setContrast(1.2)
 *
 * // Render with this chain's shader
 * gl.useProgram(compiled.program)
 * compiled.view.uniforms.u_video.set(0)
 * compiled.view.attributes.a_quad.bind()
 * gl.drawArrays(gl.TRIANGLES, 0, 6)
 * ```
 */
export function makeEffectChainCache(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
): EffectChainCache {
  const cache = new Map<string, CompiledEffectChain>()

  return {
    get(chain: VideoEffectChain): CompiledEffectChain {
      let compiled = cache.get(chain.id)
      if (!compiled) {
        const result = composeEffects(gl, chain.effects)
        compiled = {
          program: result.program,
          view: result.view,
          controls: result.controls as CompiledEffectChain['controls'],
        }
        cache.set(chain.id, compiled)
      }
      return compiled
    },

    getById(id: string): CompiledEffectChain | undefined {
      return cache.get(id)
    },

    has(id: string): boolean {
      return cache.has(id)
    },

    delete(id: string): void {
      const compiled = cache.get(id)
      if (compiled) {
        gl.deleteProgram(compiled.program)
        cache.delete(id)
      }
    },

    clear(): void {
      for (const compiled of cache.values()) {
        gl.deleteProgram(compiled.program)
      }
      cache.clear()
    },
  }
}
