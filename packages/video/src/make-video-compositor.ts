import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'
import { assertedNotNullish, debug } from '@eddy/utils'
import { composeEffectTypes } from './effects/compose-effects'
import type { CompiledEffectChain, VideoEffectChain } from './effects/types'

const log = debug('video:make-video-compositor', false)

/** Viewport in canvas coordinates */
export interface Viewport {
  x: number
  y: number
  width: number
  height: number
}

/** A placement to render */
export interface RenderPlacement {
  /** Unique ID for this placement (used for texture caching) */
  id: string
  /** VideoFrame to render */
  frame: VideoFrame
  /** Where to render on canvas */
  viewport: Viewport
  /** Effect chain to apply (undefined = passthrough, no effects) */
  effectChainId?: string
  /** Current effect values to set before rendering (one per effect in chain) */
  effectValues?: number[]
}

// View type with our specific uniforms
interface CompositorView {
  uniforms: {
    u_video: { set(value: number): void }
  }
  attributes: {
    a_quad: { bind(): void }
  }
}

/**
 * CompositorEngine handles WebGL-based video frame compositing.
 * Renders VideoFrames to an OffscreenCanvas with viewport positioning.
 */

export interface VideoCompositor {
  /** Canvas width */
  readonly width: number
  /** Canvas height */
  readonly height: number
  /** Capture the current canvas as a VideoFrame */
  captureFrame(timestamp: number): VideoFrame
  /** Clear the canvas with a background color */
  clear(r?: number, g?: number, b?: number, a?: number): void
  /** Delete a texture by ID */
  deleteTexture(id: string): void
  /** Clean up resources */
  destroy(): void
  /**
   * Upload a frame to a texture without rendering
   * (useful for capture canvas pre-staging)
   */
  uploadFrame(id: string, frame: VideoFrame): void
  /** Render multiple placements (clears first)*/
  render(placements: RenderPlacement[]): void
  /**
   * Render pre-uploaded textures by ID
   */
  renderById(
    placements: Array<{
      id: string
      viewport: Viewport
      effectChainId?: string
    }>,
  ): void
  /** Render a single placement */
  renderPlacement(placement: RenderPlacement): void

  /**********************************************************************************/
  /*                                 Effect Chains                                  */
  /**********************************************************************************/

  /**
   * Register an effect chain. Compiles the shader and caches it.
   * @returns Controls for the effects in the chain
   */
  registerEffectChain(chain: VideoEffectChain): CompiledEffectChain
  /** Check if an effect chain is registered */
  hasEffectChain(id: string): boolean
  /** Get a registered effect chain (for updating controls) */
  getEffectChain(id: string): CompiledEffectChain | undefined
  /** Remove an effect chain */
  deleteEffectChain(id: string): void
  /** Activate an effect chain (bind its program) - must be called before updating controls */
  activateEffectChain(id: string): void
}

/**********************************************************************************/
/*                                                                                */
/*                                      Utils                                     */
/*                                                                                */
/**********************************************************************************/

// Simple shader - samples a single texture per quad
const fragmentShader = glsl`
  precision mediump float;

  ${uniform.sampler2D('u_video')}

  varying vec2 v_uv;

  void main() {
    vec2 uv = v_uv * 0.5 + 0.5;
    uv.y = 1.0 - uv.y; // Flip Y for video
    gl_FragColor = texture2D(u_video, uv);
  }
`

/** Create a video texture with standard settings */
function makeVideoTexture(glCtx: WebGL2RenderingContext | WebGLRenderingContext): WebGLTexture {
  const texture = glCtx.createTexture()
  if (!texture) throw new Error('Failed to create texture')

  glCtx.bindTexture(glCtx.TEXTURE_2D, texture)
  glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_S, glCtx.CLAMP_TO_EDGE)
  glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_T, glCtx.CLAMP_TO_EDGE)
  glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MIN_FILTER, glCtx.LINEAR)
  glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MAG_FILTER, glCtx.LINEAR)

  return texture
}

/** Convert viewport from layout coordinates (y=0 at top) to WebGL coordinates (y=0 at bottom) */
function viewportToWebGL(viewport: Viewport, canvasHeight: number): Viewport {
  return {
    x: viewport.x,
    y: canvasHeight - viewport.y - viewport.height,
    width: viewport.width,
    height: viewport.height,
  }
}

/** Reserved ID for the passthrough (no effects) chain */
const PASSTHROUGH_CHAIN_ID = '__passthrough__'

/**
 * Create a compositor engine for an OffscreenCanvas
 */
export function makeVideoCompositor(canvas: OffscreenCanvas): VideoCompositor {
  const gl = assertedNotNullish(
    canvas.getContext('webgl2') ?? canvas.getContext('webgl'),
    'WebGL not supported',
  )

  const textures = new Map<string, WebGLTexture>()
  const effectChains = new Map<string, CompiledEffectChain>()

  // Compile passthrough shader (no effects)
  const passthroughCompiled = compile.toQuad(gl, fragmentShader)
  const passthroughChain: CompiledEffectChain = {
    program: passthroughCompiled.program,
    view: passthroughCompiled.view as CompiledEffectChain['view'],
    controls: [],
  }
  effectChains.set(PASSTHROUGH_CHAIN_ID, passthroughChain)

  // Default to passthrough
  let currentProgram = passthroughChain.program
  gl.useProgram(currentProgram)

  log('CompositorEngine initialized', { width: canvas.width, height: canvas.height })

  /** Get chain by id, falling back to passthrough */
  function getChain(effectChainId?: string): CompiledEffectChain {
    if (!effectChainId) return passthroughChain
    return effectChains.get(effectChainId) ?? passthroughChain
  }

  /** Switch to a different shader program if needed */
  function useChain(chain: CompiledEffectChain): void {
    // Always bind program - composeEffects may have called gl.useProgram during chain registration
    currentProgram = chain.program
    gl.useProgram(currentProgram)
  }

  function clear(r = 0.1, g = 0.1, b = 0.1, a = 1.0): void {
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(r, g, b, a)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  function renderPlacement(placement: RenderPlacement): void {
    // Get or create texture
    let texture = textures.get(placement.id)
    if (!texture) {
      texture = makeVideoTexture(gl)
      textures.set(placement.id, texture)
    }

    // Upload frame to texture
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, placement.frame)

    // Get and use the effect chain
    const chain = getChain(placement.effectChainId)
    useChain(chain)

    // Set effect values if provided (must happen after useChain binds the program)
    if (placement.effectValues && chain.controls.length > 0) {
      for (let i = 0; i < chain.controls.length; i++) {
        const controls = chain.controls[i]
        const value = placement.effectValues[i]

        if (controls && value !== undefined) {
          const setterKey = Object.keys(controls).find(key => key.startsWith('set'))
          if (setterKey && typeof controls[setterKey] === 'function') {
            controls[setterKey](value)
            // Debug: log every ~60 frames
            if (Math.random() < 0.02) {
              log('set effect value', {
                effectChainId: placement.effectChainId,
                index: i,
                value,
                setterKey,
                controls: controls[setterKey],
              })
            }
          }
        }
      }
    }

    // Convert viewport to WebGL coordinates (y flipped)
    const vp = viewportToWebGL(placement.viewport, canvas.height)
    gl.viewport(vp.x, vp.y, vp.width, vp.height)

    // Draw
    chain.view.uniforms.u_video.set(0)
    chain.view.attributes.a_quad.bind()
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  return {
    clear,
    renderPlacement,

    get width(): number {
      return canvas.width
    },

    get height(): number {
      return canvas.height
    },

    render(placements: RenderPlacement[]): void {
      clear()
      for (const placement of placements) {
        renderPlacement(placement)
      }
    },

    uploadFrame(id: string, frame: VideoFrame): void {
      let texture = textures.get(id)
      if (!texture) {
        texture = makeVideoTexture(gl)
        textures.set(id, texture)
      }

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame)
    },

    renderById(
      placements: Array<{ id: string; viewport: Viewport; effectChainId?: string }>,
    ): void {
      clear()

      for (const placement of placements) {
        const texture = textures.get(placement.id)
        if (!texture) continue

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, texture)

        // Get and use the effect chain
        const chain = getChain(placement.effectChainId)
        useChain(chain)

        const vp = viewportToWebGL(placement.viewport, canvas.height)
        gl.viewport(vp.x, vp.y, vp.width, vp.height)

        chain.view.uniforms.u_video.set(0)
        chain.view.attributes.a_quad.bind()
        gl.drawArrays(gl.TRIANGLES, 0, 6)
      }
    },

    captureFrame(timestamp: number): VideoFrame {
      return new VideoFrame(canvas, {
        timestamp,
        alpha: 'discard',
      })
    },

    deleteTexture(id: string): void {
      const texture = textures.get(id)
      if (texture) {
        gl.deleteTexture(texture)
        textures.delete(id)
      }
    },

    /**********************************************************************************/
    /*                                 Effect Chains                                  */
    /**********************************************************************************/

    registerEffectChain(chain: VideoEffectChain): CompiledEffectChain {
      // Check if already registered
      const existing = effectChains.get(chain.id)
      if (existing) return existing

      // Compile the effect chain using new deduplication-aware composer
      const result = composeEffectTypes(gl, chain.effects)
      const compiled: CompiledEffectChain = {
        program: result.program,
        view: result.view,
        controls: result.controls,
      }
      effectChains.set(chain.id, compiled)

      // Debug: Check if programs are shared across chains
      const allPrograms = [...effectChains.values()].map(c => c.program)
      const uniquePrograms = new Set(allPrograms).size
      log('Registered effect chain', {
        chainId: chain.id,
        effectCount: chain.effects.length,
        totalChains: effectChains.size,
        uniquePrograms,
        programsShared: uniquePrograms < effectChains.size,
        compiled,
      })

      return compiled
    },

    hasEffectChain(id: string): boolean {
      return effectChains.has(id)
    },

    getEffectChain(id: string): CompiledEffectChain | undefined {
      return effectChains.get(id)
    },

    deleteEffectChain(id: string): void {
      if (id === PASSTHROUGH_CHAIN_ID) return // Don't delete passthrough
      const chain = effectChains.get(id)
      if (chain) {
        gl.deleteProgram(chain.program)
        effectChains.delete(id)
      }
    },

    activateEffectChain(id: string): void {
      const chain = effectChains.get(id)
      if (chain) {
        useChain(chain)
      }
    },

    destroy(): void {
      log('destroy')
      // Clean up textures
      for (const texture of textures.values()) {
        gl.deleteTexture(texture)
      }
      textures.clear()
      // Clean up effect chain programs
      for (const [id, chain] of effectChains) {
        if (id !== PASSTHROUGH_CHAIN_ID) {
          gl.deleteProgram(chain.program)
        }
      }
      effectChains.clear()
    },
  }
}
