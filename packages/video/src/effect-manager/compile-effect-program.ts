/**
 * Compile Effect Program
 *
 * Composes multiple video effects into a single fragment shader.
 * Supports deduplication: same effect type used multiple times
 * inlines the function once with array uniforms.
 */

import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'
import type { VideoEffectType } from '../effects/types'
import type { EffectKey, EffectProgram, EffectRegistry } from './types'

/**
 * Compose effect instances into a single shader program.
 * Deduplicates: same effect type appears once in shader with array uniforms.
 *
 * @param gl - WebGL context
 * @param registry - Effect registry to look up effect types
 * @param effectKeys - Array of effect instances to compose (in order)
 * @returns Compiled program and controls for each instance
 *
 * @example
 * ```ts
 * const registry = makeEffectRegistry(effectCatalog)
 * const composed = compileEffectProgram(gl, registry, [
 *   'visual.brightness',
 *   'visual.contrast',
 *   'visual.brightness',
 * ])
 * // Shader has: applyBrightness once (size=2), applyContrast once (size=1)
 * // Calls: applyBrightness(color, 0), applyContrast(color, 0), applyBrightness(color, 1)
 * ```
 */
export function compileEffectProgram(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  registry: EffectRegistry,
  effectKeys: EffectKey[],
): EffectProgram {
  // Step 1: Count instances per effect type
  const typeCounts = new Map<string, number>()
  for (const effectKey of effectKeys) {
    typeCounts.set(effectKey, (typeCounts.get(effectKey) ?? 0) + 1)
  }

  // Step 2: Create each effect type once with the correct size
  const effectTypes = new Map<string, VideoEffectType>()
  for (const [type, count] of typeCounts) {
    const effectType = registry.get(type, count)
    if (effectType) {
      effectTypes.set(type, effectType)
    }
  }

  // Step 3: Track instance index per type for generating calls
  const typeInstanceIndex = new Map<string, number>()
  for (const type of typeCounts.keys()) {
    typeInstanceIndex.set(type, 0)
  }

  // Step 4: Build effect chain with indexed calls
  const effectChain =
    effectKeys.length > 0
      ? effectKeys.map(effectTypeName => {
          const effect = effectTypes.get(effectTypeName)
          if (!effect) return glsl`/* unknown effect: ${effectTypeName} */`

          const index = typeInstanceIndex.get(effectTypeName)!
          typeInstanceIndex.set(effectTypeName, index + 1)

          return glsl`color = ${effect.apply}(color, ${index});`
        })
      : ['/* no effects */']

  // Step 5: Build fragment shader (each type's fragment included once)
  const uniqueFragments = Array.from(effectTypes.values()).map(et => et.fragment)

  const fragmentShader = glsl`#version 300 es
    precision mediump float;

    ${uniform.sampler2D('u_video')}
    ${uniqueFragments}

    in vec2 v_uv;
    out vec4 fragColor;

    void main() {
      vec2 uv = v_uv * 0.5 + 0.5;
      uv.y = 1.0 - uv.y;
      vec4 color = texture(u_video, uv);
      ${effectChain}
      fragColor = color;
    }
  `

  const compiled = compile.toQuad(gl, fragmentShader)
  const program = compiled.program

  // Activate program before setting initial uniform values
  gl.useProgram(program)

  // Step 6: Reset instance indices and connect each instance
  for (const type of typeCounts.keys()) {
    typeInstanceIndex.set(type, 0)
  }

  const controls = effectKeys.map(effectTypeName => {
    const effect = effectTypes.get(effectTypeName)
    if (!effect) return {}

    const index = typeInstanceIndex.get(effectTypeName)!
    typeInstanceIndex.set(effectTypeName, index + 1)

    return effect.connect(gl, program, index)
  })

  return {
    program,
    controls,
    view: compiled.view as EffectProgram['view'],
  }
}
