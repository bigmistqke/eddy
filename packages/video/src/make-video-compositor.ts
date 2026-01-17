import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'
import { assertedNotNullish, debug } from '@eddy/utils'

const log = debug('video:compositor:engine', false)

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
    }>,
  ): void
  /** Render a single placement */
  renderPlacement(placement: RenderPlacement): void
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

/**
 * Create a compositor engine for an OffscreenCanvas
 */
export function makeVideoCompositor(canvas: OffscreenCanvas): VideoCompositor {
  const gl = assertedNotNullish(
    canvas.getContext('webgl2') ?? canvas.getContext('webgl'),
    'WebGL not supported',
  )

  const textures = new Map<string, WebGLTexture>()

  // Compile shader
  const compiled = compile.toQuad(gl, fragmentShader)
  const view = compiled.view as CompositorView
  const program = compiled.program

  gl.useProgram(program)

  log('CompositorEngine initialized', { width: canvas.width, height: canvas.height })

  function clear(r = 0.1, g = 0.1, b = 0.1, a = 1.0): void {
    gl.useProgram(program)
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

    // Convert viewport to WebGL coordinates (y flipped)
    const vp = viewportToWebGL(placement.viewport, canvas.height)
    gl.viewport(vp.x, vp.y, vp.width, vp.height)

    // Draw
    view.uniforms.u_video.set(0)
    view.attributes.a_quad.bind()
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

    renderById(placements: Array<{ id: string; viewport: Viewport }>): void {
      clear()

      for (const placement of placements) {
        const texture = textures.get(placement.id)
        if (!texture) continue

        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, texture)

        const vp = viewportToWebGL(placement.viewport, canvas.height)
        gl.viewport(vp.x, vp.y, vp.width, vp.height)

        view.uniforms.u_video.set(0)
        view.attributes.a_quad.bind()
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
      for (const texture of textures.values()) {
        gl.deleteTexture(texture)
      }
      textures.clear()
    },
  }
}
