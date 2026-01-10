import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'
import { debug } from '@eddy/utils'

const log = debug('compositor:engine', false)

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
function createVideoTexture(glCtx: WebGL2RenderingContext | WebGLRenderingContext): WebGLTexture {
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
 * CompositorEngine handles WebGL-based video frame compositing.
 * Renders VideoFrames to an OffscreenCanvas with viewport positioning.
 */
export class CompositorEngine {
  private canvas: OffscreenCanvas
  private gl: WebGL2RenderingContext | WebGLRenderingContext
  private view: CompositorView
  private program: WebGLProgram
  private textures = new Map<string, WebGLTexture>()

  constructor(canvas: OffscreenCanvas) {
    this.canvas = canvas
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')

    if (!gl) {
      throw new Error('WebGL not supported')
    }

    this.gl = gl

    // Compile shader
    const compiled = compile.toQuad(gl, fragmentShader)
    this.view = compiled.view as CompositorView
    this.program = compiled.program

    gl.useProgram(this.program)

    log('CompositorEngine initialized', { width: canvas.width, height: canvas.height })
  }

  /** Canvas width */
  get width(): number {
    return this.canvas.width
  }

  /** Canvas height */
  get height(): number {
    return this.canvas.height
  }

  /**
   * Clear the canvas with a background color
   */
  clear(r = 0.1, g = 0.1, b = 0.1, a = 1.0): void {
    const { gl, canvas, program } = this
    gl.useProgram(program)
    gl.viewport(0, 0, canvas.width, canvas.height)
    gl.clearColor(r, g, b, a)
    gl.clear(gl.COLOR_BUFFER_BIT)
  }

  /**
   * Render a single placement
   */
  renderPlacement(placement: RenderPlacement): void {
    const { gl, canvas, view, textures } = this

    // Get or create texture
    let texture = textures.get(placement.id)
    if (!texture) {
      texture = createVideoTexture(gl)
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

  /**
   * Render multiple placements (clears first)
   */
  render(placements: RenderPlacement[]): void {
    this.clear()
    for (const placement of placements) {
      this.renderPlacement(placement)
    }
  }

  /**
   * Upload a frame to a texture without rendering
   * (useful for capture canvas pre-staging)
   */
  uploadFrame(id: string, frame: VideoFrame): void {
    const { gl, textures } = this

    let texture = textures.get(id)
    if (!texture) {
      texture = createVideoTexture(gl)
      textures.set(id, texture)
    }

    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame)
  }

  /**
   * Render pre-uploaded textures by ID
   */
  renderById(placements: Array<{ id: string; viewport: Viewport }>): void {
    const { gl, canvas, view, textures } = this

    this.clear()

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
  }

  /**
   * Capture the current canvas as a VideoFrame
   */
  captureFrame(timestamp: number): VideoFrame {
    return new VideoFrame(this.canvas, {
      timestamp,
      alpha: 'discard',
    })
  }

  /**
   * Delete a texture by ID
   */
  deleteTexture(id: string): void {
    const texture = this.textures.get(id)
    if (texture) {
      this.gl.deleteTexture(texture)
      this.textures.delete(id)
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    log('destroy')
    for (const texture of this.textures.values()) {
      this.gl.deleteTexture(texture)
    }
    this.textures.clear()
  }
}

/**
 * Create a compositor engine for an OffscreenCanvas
 */
export function createCompositorEngine(canvas: OffscreenCanvas): CompositorEngine {
  return new CompositorEngine(canvas)
}
