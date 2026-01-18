/**
 * Compose Effects
 *
 * Composes multiple video effects into a single fragment shader.
 * Supports deduplication: same effect type used multiple times
 * inlines the function once with array uniforms.
 */

import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'
import type { EffectControls, EffectInstance, VideoEffectType } from './types'
import { createVideoEffectFromRegistry } from './video-effect-registry'

/** Result of composing effect types */
export interface ComposedEffectTypes {
  /** The compiled WebGL program */
  program: WebGLProgram
  /** Controls for each effect instance, in order */
  controls: EffectControls[]
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
 * Compose effect instances into a single shader program.
 * Deduplicates: same effect type appears once in shader with array uniforms.
 *
 * @param gl - WebGL context
 * @param instances - Array of effect instances to compose (in order)
 * @returns Compiled program and controls for each instance
 *
 * @example
 * ```ts
 * const composed = composeEffectTypes(gl, [
 *   { type: 'visual.brightness', initialValues: { brightness: 10 } },
 *   { type: 'visual.contrast', initialValues: { contrast: 120 } },
 *   { type: 'visual.brightness', initialValues: { brightness: -5 } },
 * ])
 * // Shader has: applyBrightness once (size=2), applyContrast once (size=1)
 * // Calls: applyBrightness(color, 0), applyContrast(color, 0), applyBrightness(color, 1)
 * ```
 */
export function composeEffectTypes(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  instances: EffectInstance[],
): ComposedEffectTypes {
  // Step 1: Count instances per effect type
  const typeCounts = new Map<string, number>()
  for (const instance of instances) {
    typeCounts.set(instance.type, (typeCounts.get(instance.type) ?? 0) + 1)
  }

  // Step 2: Create each effect type once with the correct size
  const effectTypes = new Map<string, VideoEffectType>()
  for (const [type, count] of typeCounts) {
    const effectType = createVideoEffectFromRegistry(type, count)
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
    instances.length > 0
      ? instances.map(instance => {
          const effectType = effectTypes.get(instance.type)
          if (!effectType) return glsl`/* unknown effect: ${instance.type} */`

          const index = typeInstanceIndex.get(instance.type)!
          typeInstanceIndex.set(instance.type, index + 1)

          return glsl`color = ${effectType.apply}(color, ${index});`
        })
      : [glsl`/* no effects */`]

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

  const controls = instances.map(instance => {
    const effectType = effectTypes.get(instance.type)
    if (!effectType) return {}

    const index = typeInstanceIndex.get(instance.type)!
    typeInstanceIndex.set(instance.type, index + 1)

    return effectType.connect(gl, program, index, instance.initialValues)
  })

  return {
    program,
    controls,
    view: compiled.view as ComposedEffectTypes['view'],
  }
}
