// render-loop-all-bitmap — no atlas, no codec at render time. Each
// cell uploads a raw-RGBA Uint8Array from an in-memory array of
// pre-decoded frames. Tests whether 25b's predicted upload budget
// holds end-to-end (upload + draws + rAF + clear) at K=4/9/16/25.

import { recordProbeInput, type ProbeInput } from "../harness/input"
import {
  JankRecorder,
  observeLongTasks,
  type JankReport,
  type LongTaskReport,
} from "../harness/jank"
import { reportResult, status } from "../harness/report"

const params = {
  captureResolution: { width: 1280, height: 720 },
  sourceSeconds: 6,
  runSeconds: 10,
  /** Frames to extract per pass — 60 ≈ 2 s of source content,
   *  looped. Enough for visible motion, low enough on memory. */
  framesPerPass: 60,
  passes: [
    { k: 4, gridCols: 2, gridRows: 2, mip: { label: "540p", width: 960, height: 544 } },
    { k: 9, gridCols: 3, gridRows: 3, mip: { label: "360p", width: 640, height: 368 } },
    { k: 16, gridCols: 4, gridRows: 4, mip: { label: "270p", width: 480, height: 272 } },
    { k: 25, gridCols: 5, gridRows: 5, mip: { label: "180p", width: 320, height: 184 } },
  ],
}

const snap16 = (value: number): number => Math.max(16, Math.round(value / 16) * 16)

interface BitmapStream {
  width: number
  height: number
  frames: Uint8Array[]
  totalBytes: number
}

/** Decode source clip → downscale frames to target mip res → store as
 *  raw RGBA Uint8Arrays in memory. Returns one BitmapStream that all
 *  K cells share for a given pass. */
async function decodeToRgba(
  source: ProbeInput,
  targetW: number,
  targetH: number,
  maxFrames: number,
): Promise<BitmapStream | null> {
  const width = snap16(targetW)
  const height = snap16(targetH)
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext("2d")
  if (context === null) {
    return null
  }
  const frames: Uint8Array[] = []
  let totalBytes = 0
  const { promise: done, resolve: resolveDone } = Promise.withResolvers<void>()
  const decoder = new VideoDecoder({
    output(frame) {
      if (frames.length >= maxFrames) {
        frame.close()
        return
      }
      try {
        context.drawImage(frame, 0, 0, width, height)
        const imageData = context.getImageData(0, 0, width, height)
        const bytes = new Uint8Array(imageData.data.buffer.slice(0))
        frames.push(bytes)
        totalBytes += bytes.byteLength
      } catch {}
      frame.close()
    },
    error() {},
  })
  decoder.configure(source.config)
  for (const chunk of source.chunks) {
    if (frames.length >= maxFrames) {
      break
    }
    decoder.decode(chunk)
  }
  try {
    await decoder.flush()
  } catch {}
  decoder.close()
  resolveDone()
  await done
  if (frames.length === 0) {
    return null
  }
  return { width, height, frames, totalBytes }
}

interface PassResult {
  k: number
  mip: string
  mipWidth: number
  mipHeight: number
  frameCount: number
  bitmapBytesMb: number
  totalUploadsPerTick: number
  jank: JankReport
  longTasks: LongTaskReport
}

async function runRenderLoop(
  stream: BitmapStream,
  k: number,
  gridCols: number,
  gridRows: number,
): Promise<{ jank: JankReport; longTasks: LongTaskReport }> {
  const canvas = document.createElement("canvas")
  canvas.width = window.innerWidth * (window.devicePixelRatio || 1)
  canvas.height = window.innerHeight * (window.devicePixelRatio || 1)
  canvas.style.cssText =
    "position:fixed;inset:0;width:100vw;height:100vh;z-index:0;display:block"
  document.body.appendChild(canvas)
  const glOrNull = canvas.getContext("webgl2")
  if (glOrNull === null) {
    document.body.removeChild(canvas)
    throw new Error("runRenderLoop: no webgl2 context")
  }
  const gl = glOrNull

  const vs = gl.createShader(gl.VERTEX_SHADER)!
  gl.shaderSource(
    vs,
    `#version 300 es
in vec2 aQuad;
uniform vec2 uNdcOffset;
uniform vec2 uNdcScale;
out vec2 vUv;
void main() {
  vec2 corner = (aQuad + 1.0) * 0.5;
  vUv = vec2(corner.x, 1.0 - corner.y);
  gl_Position = vec4(uNdcOffset + corner * uNdcScale, 0.0, 1.0);
}`,
  )
  gl.compileShader(vs)
  const fs = gl.createShader(gl.FRAGMENT_SHADER)!
  gl.shaderSource(
    fs,
    `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
out vec4 outColor;
void main() { outColor = texture(uTex, vUv); }`,
  )
  gl.compileShader(fs)
  const program = gl.createProgram()!
  gl.attachShader(program, vs)
  gl.attachShader(program, fs)
  gl.linkProgram(program)
  gl.useProgram(program)
  const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW)
  const aQuad = gl.getAttribLocation(program, "aQuad")
  gl.enableVertexAttribArray(aQuad)
  gl.vertexAttribPointer(aQuad, 2, gl.FLOAT, false, 0, 0)
  const uNdcOffset = gl.getUniformLocation(program, "uNdcOffset")
  const uNdcScale = gl.getUniformLocation(program, "uNdcScale")
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)

  const textures: WebGLTexture[] = []
  for (let i = 0; i < k; i++) {
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    textures.push(tex)
  }

  const recorder = new JankRecorder()
  const longTasks = observeLongTasks()
  const deadline = performance.now() + params.runSeconds * 1000
  const startWall = performance.now()
  const totalFrames = stream.frames.length
  const viewportCellW = 2 / gridCols
  const viewportCellH = 2 / gridRows

  await new Promise<void>(resolveLoop => {
    function tick(now: number) {
      if (now >= deadline) {
        resolveLoop()
        return
      }
      recorder.mark(now)
      const elapsedMs = now - startWall
      gl.clear(gl.COLOR_BUFFER_BIT)
      // Per-cell frame index = (elapsed * 30 / 1000 + cellPhase) mod total.
      // Phase offset per cell so cells aren't visually synchronised
      // (no behavioural impact on perf, just diagnostic).
      const baseIndex = Math.floor((elapsedMs * 30) / 1000)
      for (let i = 0; i < k; i++) {
        const frameIdx = (baseIndex + i * 3) % totalFrames
        const bytes = stream.frames[frameIdx]
        gl.bindTexture(gl.TEXTURE_2D, textures[i])
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          stream.width,
          stream.height,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          bytes,
        )
        const row = Math.floor(i / gridCols)
        const col = i % gridCols
        gl.uniform2f(uNdcOffset, -1 + col * viewportCellW, 1 - (row + 1) * viewportCellH)
        gl.uniform2f(uNdcScale, viewportCellW, viewportCellH)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  const longTaskReport = longTasks.stop()
  const jank = recorder.snapshot()

  for (const tex of textures) {
    gl.deleteTexture(tex)
  }
  gl.deleteBuffer(buffer)
  gl.deleteProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  document.body.removeChild(canvas)

  return { jank, longTasks: longTaskReport }
}

async function run(): Promise<void> {
  status(`render-loop-all-bitmap: ${params.passes.length} K-values × ${params.runSeconds}s`)
  status(`recording source clip (${params.sourceSeconds}s)...`)
  const source = await recordProbeInput(
    params.captureResolution.width,
    params.captureResolution.height,
    params.sourceSeconds,
  )
  status(`  got ${source.width}x${source.height}, ${source.chunks.length} chunks`)

  const results: PassResult[] = []
  for (const pass of params.passes) {
    status(`PASS K=${pass.k} grid=${pass.gridCols}×${pass.gridRows} mip=${pass.mip.label}`)
    status(`  decoding source → ${pass.mip.width}×${pass.mip.height} raw RGBA × ${params.framesPerPass} frames...`)
    const stream = await decodeToRgba(
      source,
      pass.mip.width,
      pass.mip.height,
      params.framesPerPass,
    )
    if (stream === null) {
      status(`  decode FAILED — skipping`)
      continue
    }
    const bytesMb = stream.totalBytes / 1024 / 1024
    status(`  ${stream.frames.length} frames, ${bytesMb.toFixed(1)} MB in memory`)
    const { jank, longTasks } = await runRenderLoop(stream, pass.k, pass.gridCols, pass.gridRows)
    results.push({
      k: pass.k,
      mip: pass.mip.label,
      mipWidth: stream.width,
      mipHeight: stream.height,
      frameCount: stream.frames.length,
      bitmapBytesMb: bytesMb,
      totalUploadsPerTick: pass.k,
      jank,
      longTasks,
    })
    status(
      `  fps=${(jank.framesObserved / params.runSeconds).toFixed(1)} ` +
        `mean=${jank.meanMs.toFixed(1)}ms p95=${jank.p95Ms.toFixed(1)}ms ` +
        `over33=${(jank.over33msRatio * 100).toFixed(1)}% ` +
        `streak=${jank.longestJankStreak} score=${jank.jankScore.toFixed(1)} ` +
        `longtasks=${longTasks.observed}`,
    )
    // Free this pass's bitmap stream before the next.
    stream.frames.length = 0
  }
  status("done.")
  reportResult("render-loop-all-bitmap", params, { passes: results })
}

run().catch((error: unknown) => {
  status(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  reportResult("render-loop-all-bitmap", params, {
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  })
})
