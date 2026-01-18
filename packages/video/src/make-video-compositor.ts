/**
 * Make Video Compositor
 *
 * WebGL-based video frame compositing. Renders VideoFrames to an OffscreenCanvas
 * with viewport positioning. Effect chains are managed externally via EffectManager.
 */

import { assertedNotNullish, debug } from '@eddy/utils'
import type { CompiledEffectChain } from './effect-manager'
import type { EffectControls } from './effects'

const log = debug('video:make-video-compositor', false)

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

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
  /** Compiled effect chain to use (undefined = use passthrough) */
  effectChain?: CompiledEffectChain
  /** Current effect values to set before rendering (one per effect in chain) */
  effectValues?: number[]
}

/** A placement to render by pre-uploaded texture ID */
export interface RenderByIdPlacement {
  /** Texture ID (must have been uploaded via uploadFrame) */
  id: string
  /** Where to render on canvas */
  viewport: Viewport
  /** Compiled effect chain to use (undefined = use passthrough) */
  effectChain?: CompiledEffectChain
  /** Current effect values to set before rendering */
  effectValues?: number[]
}

export interface VideoCompositor {
  /** Canvas width */
  readonly width: number
  /** Canvas height */
  readonly height: number
  /** The WebGL context */
  readonly gl: WebGL2RenderingContext | WebGLRenderingContext
  /** The passthrough chain (no effects) - for rendering without effects */
  readonly passthrough: CompiledEffectChain
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
  /** Render multiple placements (clears first) */
  render(placements: RenderPlacement[]): void
  /** Render pre-uploaded textures by ID */
  renderById(placements: RenderByIdPlacement[]): void
  /** Render a single placement */
  renderPlacement(placement: RenderPlacement): void
}

/**********************************************************************************/
/*                                                                                */
/*                                     Utils                                      */
/*                                                                                */
/**********************************************************************************/

/** Create a video texture with standard settings */
function makeVideoTexture(gl: WebGL2RenderingContext | WebGLRenderingContext): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Failed to create texture')

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

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

/** Apply effect values to controls */
function applyEffectValues(controls: EffectControls[], values: number[] | undefined): void {
  if (!values || controls.length === 0) return

  for (let index = 0; index < controls.length; index++) {
    const control = controls[index]
    const value = values[index]

    if (control && value !== undefined) {
      const setterKey = Object.keys(control).find(key => key.startsWith('set'))
      if (setterKey && typeof control[setterKey] === 'function') {
        control[setterKey](value)
      }
    }
  }
}

/**********************************************************************************/
/*                                                                                */
/*                              Make Video Compositor                             */
/*                                                                                */
/**********************************************************************************/

// Inline passthrough shader compilation using view.gl
import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'

const passthroughFragment = glsl`
  precision mediump float;

  ${uniform.sampler2D('u_video')}

  varying vec2 v_uv;

  void main() {
    vec2 uv = v_uv * 0.5 + 0.5;
    uv.y = 1.0 - uv.y;
    gl_FragColor = texture2D(u_video, uv);
  }
`

/**
 * Create a compositor for an OffscreenCanvas.
 * Handles texture management and rendering. Effect compilation is external.
 */
export function makeVideoCompositor(canvas: OffscreenCanvas): VideoCompositor {
  const gl = assertedNotNullish(
    canvas.getContext('webgl2') ?? canvas.getContext('webgl'),
    'WebGL not supported',
  )

  const textures = new Map<string, WebGLTexture>()

  // Compile passthrough shader
  const passthroughCompiled = compile.toQuad(gl, passthroughFragment)
  const passthrough: CompiledEffectChain = {
    program: passthroughCompiled.program,
    view: passthroughCompiled.view as CompiledEffectChain['view'],
    controls: [],
  }

  let currentProgram: WebGLProgram | null = null

  log('VideoCompositor initialized', { width: canvas.width, height: canvas.height })

  /** Switch to a different shader program if needed */
  function useChain(chain: CompiledEffectChain): void {
    if (currentProgram !== chain.program) {
      currentProgram = chain.program
      gl.useProgram(currentProgram)
    }
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

    // Use the effect chain (or passthrough)
    const chain = placement.effectChain ?? passthrough
    useChain(chain)

    // Set effect values
    applyEffectValues(chain.controls, placement.effectValues)

    // Convert viewport to WebGL coordinates (y flipped)
    const vp = viewportToWebGL(placement.viewport, canvas.height)
    gl.viewport(vp.x, vp.y, vp.width, vp.height)

    // Draw
    chain.view.uniforms.u_video.set(0)
    chain.view.attributes.a_quad.bind()
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  return {
    get width(): number {
      return canvas.width
    },

    get height(): number {
      return canvas.height
    },

    get gl() {
      return gl
    },

    passthrough,

    clear,
    renderPlacement,

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

    renderById(placements: RenderByIdPlacement[]): void {
      clear()

      for (const placement of placements) {
        const texture = textures.get(placement.id)
        if (!texture) continue

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, texture)

        // Use the effect chain (or passthrough)
        const chain = placement.effectChain ?? passthrough
        useChain(chain)

        // Set effect values
        applyEffectValues(chain.controls, placement.effectValues)

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

    destroy(): void {
      log('destroy')
      // Clean up textures
      for (const texture of textures.values()) {
        gl.deleteTexture(texture)
      }
      textures.clear()
    },
  }
}
