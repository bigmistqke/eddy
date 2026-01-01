import { compile, glsl, uniform } from '@bigmistqke/view.gl/tag'

const fragmentShader = glsl`
  precision mediump float;

  ${uniform.sampler2D('u_video')}
  ${uniform.vec2('u_resolution')}
  ${uniform.float('u_mirror')}

  varying vec2 v_uv;

  void main() {
    vec2 coord = v_uv * 0.5 + 0.5;

    // Mirror horizontally if enabled (for selfie camera)
    if (u_mirror > 0.5) {
      coord.x = 1.0 - coord.x;
    }

    gl_FragColor = texture2D(u_video, coord);
  }
`

function createVideoTexture(gl: WebGLRenderingContext | WebGL2RenderingContext): WebGLTexture {
  const texture = gl.createTexture()
  if (!texture) throw new Error('Failed to create texture')

  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

  return texture
}

export interface Compositor {
  canvas: HTMLCanvasElement
  setVideo: (video: HTMLVideoElement) => void
  setMirror: (mirror: boolean) => void
  render: () => void
  destroy: () => void
}

export function createCompositor(width: number, height: number): Compositor {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const gl = canvas.getContext('webgl2') || canvas.getContext('webgl')
  if (!gl) throw new Error('WebGL not supported')

  const { view, program } = compile.toQuad(gl, fragmentShader)
  const texture = createVideoTexture(gl)

  let videoElement: HTMLVideoElement | null = null
  let mirror = true

  // Use program and set initial uniforms
  gl.useProgram(program)
  view.uniforms.u_resolution.set(width, height)
  view.uniforms.u_mirror.set(mirror ? 1 : 0)

  return {
    canvas,

    setVideo(video: HTMLVideoElement) {
      videoElement = video
    },

    setMirror(value: boolean) {
      mirror = value
      gl.useProgram(program)
      view.uniforms.u_mirror.set(value ? 1 : 0)
    },

    render() {
      if (!videoElement || videoElement.readyState < 2) return

      gl.useProgram(program)

      // Update texture from video
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        videoElement
      )

      // Set uniforms
      view.uniforms.u_video.set(0)
      view.uniforms.u_resolution.set(canvas.width, canvas.height)
      view.uniforms.u_mirror.set(mirror ? 1 : 0)

      // Bind quad attribute
      view.attributes.a_quad.bind()

      // Draw
      gl.viewport(0, 0, canvas.width, canvas.height)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    },

    destroy() {
      gl.deleteTexture(texture)
    },
  }
}
