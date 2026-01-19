/**
 * Compile Branching Program
 *
 * Compiles parallel effect branches into a single shader with weighted blending.
 * For video pipelines with multiple weighted outputs, this generates GLSL that:
 * 1. Applies root effects to the input
 * 2. Splits into parallel branches
 * 3. Applies branch-specific effects
 * 4. Blends branches with weight uniforms at merge point
 */

import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'
import type { VideoEffectType, EffectControls } from '../effects/types'
import type { EffectKey, EffectRegistry } from './types'

/**********************************************************************************/
/*                                                                                */
/*                                      Types                                     */
/*                                                                                */
/**********************************************************************************/

/** A branch in the effect pipeline */
export interface EffectBranch {
  /** Unique identifier for this branch (used for uniform naming) */
  id: string
  /** Effect keys to apply in this branch */
  effectKeys: EffectKey[]
  /** Initial weight (0-1) for blending */
  weight: number
}

/** Input for compiling a branching program */
export interface BranchingProgramInput {
  /** Root effect keys applied before branching */
  rootEffectKeys: EffectKey[]
  /** Parallel branches to merge with weighted blending */
  branches: EffectBranch[]
}

/** Controls for a branch (includes weight setter and effect controls) */
export interface BranchControls {
  /** Set the blend weight for this branch (0-1) */
  setWeight: (value: number) => void
  /** Controls for each effect in the branch, in order */
  effectControls: EffectControls[]
}

/** Result of compiling a branching program */
export interface BranchingProgram {
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
  /** Controls for root effects (before branching), in order */
  rootControls: EffectControls[]
  /** Controls for each branch, keyed by branch id */
  branchControls: Map<string, BranchControls>
}

/**********************************************************************************/
/*                                                                                */
/*                           Compile Branching Program                            */
/*                                                                                */
/**********************************************************************************/

/**
 * Compile effect branches into a single shader program with weighted blending.
 *
 * @param gl - WebGL context
 * @param registry - Effect registry to look up effect types
 * @param input - Root effects and parallel branches
 * @returns Compiled program with controls for all effects and branch weights
 *
 * @example
 * ```ts
 * const branching = compileBranchingProgram(gl, registry, {
 *   rootEffectKeys: ['visual.brightness'],
 *   branches: [
 *     { id: 'A', effectKeys: ['visual.saturation'], weight: 0.5 },
 *     { id: 'B', effectKeys: ['visual.colorize'], weight: 0.5 },
 *   ]
 * })
 *
 * // Generated shader:
 * // vec4 color = texture(u_video, uv);
 * // color = applyBrightness(color, 0);  // root
 * // vec4 root_out = color;
 * // vec4 branch_A = root_out;
 * // branch_A = applySaturation(branch_A, 0);
 * // vec4 branch_B = root_out;
 * // branch_B = applyColorize(branch_B, 0);
 * // fragColor = branch_A * u_weight_A + branch_B * u_weight_B;
 * ```
 */
export function compileBranchingProgram(
  gl: WebGL2RenderingContext | WebGLRenderingContext,
  registry: EffectRegistry,
  input: BranchingProgramInput,
): BranchingProgram {
  const { rootEffectKeys, branches } = input

  // Collect all effect keys for deduplication (root + all branches)
  const allEffectKeys = [
    ...rootEffectKeys,
    ...branches.flatMap(branch => branch.effectKeys),
  ]

  // Step 1: Count instances per effect type across entire program
  const typeCounts = new Map<string, number>()
  for (const effectKey of allEffectKeys) {
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
  function resetTypeIndices() {
    for (const type of typeCounts.keys()) {
      typeInstanceIndex.set(type, 0)
    }
  }

  // Helper to generate an apply call and increment index
  function generateApplyCall(effectKey: string, colorVar: string): ReturnType<typeof glsl> {
    const effect = effectTypes.get(effectKey)
    if (!effect) return glsl`/* unknown effect: ${effectKey} */`

    const index = typeInstanceIndex.get(effectKey)!
    typeInstanceIndex.set(effectKey, index + 1)

    return glsl`${colorVar} = ${effect.apply}(${colorVar}, ${index});`
  }

  // Step 4: Generate shader code
  resetTypeIndices()

  // Root effects (applied to 'color')
  const rootEffectCode =
    rootEffectKeys.length > 0
      ? rootEffectKeys.map(key => generateApplyCall(key, 'color'))
      : []

  // Branch declarations and effects
  const branchDeclarations: ReturnType<typeof glsl>[] = []
  const branchEffectCode: ReturnType<typeof glsl>[] = []
  const weightUniformDecls: string[] = []
  const blendTerms: string[] = []

  for (const branch of branches) {
    const branchVar = `branch_${branch.id}`
    const weightUniform = `u_weight_${branch.id}`

    // Declare weight uniform (raw GLSL string, not using view.gl uniform)
    weightUniformDecls.push(`uniform float ${weightUniform};`)

    // Declare branch variable (copy from root)
    branchDeclarations.push(glsl`vec4 ${branchVar} = root_out;`)

    // Apply branch effects
    for (const effectKey of branch.effectKeys) {
      branchEffectCode.push(generateApplyCall(effectKey, branchVar))
    }

    // Add blend term
    blendTerms.push(`${branchVar} * ${weightUniform}`)
  }

  // Generate final blend expression
  const blendExpression =
    branches.length > 0
      ? blendTerms.join(' + ')
      : 'root_out'

  // Step 5: Build fragment shader
  const uniqueFragments = Array.from(effectTypes.values()).map(et => et.fragment)

  // Join weight uniform declarations as raw GLSL
  const weightUniformsGlsl = weightUniformDecls.join('\n    ')

  const fragmentShader = glsl`#version 300 es
    precision mediump float;

    ${uniform.sampler2D('u_video')}
    ${weightUniformsGlsl}
    ${uniqueFragments}

    in vec2 v_uv;
    out vec4 fragColor;

    void main() {
      vec2 uv = v_uv * 0.5 + 0.5;
      uv.y = 1.0 - uv.y;
      vec4 color = texture(u_video, uv);

      // Root effects
      ${rootEffectCode}
      vec4 root_out = color;

      // Branch declarations
      ${branchDeclarations}

      // Branch effects
      ${branchEffectCode}

      // Blend branches with weights
      fragColor = ${blendExpression};
    }
  `

  const compiled = compile.toQuad(gl, fragmentShader)
  const program = compiled.program

  // Activate program before setting uniforms
  gl.useProgram(program)

  // Step 6: Connect controls
  resetTypeIndices()

  // Root effect controls
  const rootControls = rootEffectKeys.map(effectKey => {
    const effect = effectTypes.get(effectKey)
    if (!effect) return {}

    const index = typeInstanceIndex.get(effectKey)!
    typeInstanceIndex.set(effectKey, index + 1)

    return effect.connect(gl, program, index)
  })

  // Branch controls (weight + effect controls)
  const branchControls = new Map<string, BranchControls>()

  for (const branch of branches) {
    const weightUniform = `u_weight_${branch.id}`
    const weightLocation = gl.getUniformLocation(program, weightUniform)

    // Set initial weight
    if (weightLocation) {
      gl.uniform1f(weightLocation, branch.weight)
    }

    const effectControls = branch.effectKeys.map(effectKey => {
      const effect = effectTypes.get(effectKey)
      if (!effect) return {}

      const index = typeInstanceIndex.get(effectKey)!
      typeInstanceIndex.set(effectKey, index + 1)

      return effect.connect(gl, program, index)
    })

    branchControls.set(branch.id, {
      setWeight(value: number) {
        if (weightLocation) {
          gl.uniform1f(weightLocation, value)
        }
      },
      effectControls,
    })
  }

  return {
    program,
    view: compiled.view as BranchingProgram['view'],
    rootControls,
    branchControls,
  }
}
