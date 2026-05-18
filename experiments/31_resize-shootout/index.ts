// resize-shootout — compares 720p→270p downscale techniques on real
// camera VideoFrames. Each captured camera frame is run through every
// technique; per-method per-frame cost is recorded, and a sample of
// frames per method is encoded to AV1 270p for round-trip validation.

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  EncodedPacketSink,
  Input,
  Output,
  VideoSample,
  VideoSampleSource,
  WebMOutputFormat,
} from "mediabunny"
import { wait } from "../../src/utils"
import { reportResult, status } from "../harness/report"

const params = {
  sourceResolution: { width: 1280, height: 720 },
  targetResolution: { width: 480, height: 272 },
  targetFrames: 150,
  validateEncodeFrames: 30,
  codec: "av1" as const,
  bitratePerPixel: 0.1,
  targetFps: 30,
}

interface TechniqueResult {
  name: string
  setupMs: number
  samples: number
  p50Ms: number
  p95Ms: number
  maxMs: number
  encodeFramesSubmitted: number
  encodeFramesEncoded: number
  encodeRoundTripDemuxed: number
  encodeRoundTripOk: boolean
  available: boolean
  skippedReason: string | null
  errors: string[]
}

interface Technique {
  name: string
  // If false, skip the per-technique encode-round-trip validation (e.g.
  // passthrough produces a source-res frame that the 270p encoder would
  // reject).
  validateEncode?: boolean
  setup(): Promise<void>
  resize(frame: VideoFrame, timestampUs: number): Promise<VideoFrame>
  dispose(): void
}

function makeCreateImageBitmapTechnique(quality: "low" | "medium" | "high"): Technique {
  return {
    name: `createImageBitmap-${quality}`,
    async setup(): Promise<void> {},
    async resize(frame: VideoFrame, timestampUs: number): Promise<VideoFrame> {
      const bitmap = await createImageBitmap(frame, {
        resizeWidth: params.targetResolution.width,
        resizeHeight: params.targetResolution.height,
        resizeQuality: quality,
      })
      const out = new VideoFrame(bitmap, { timestamp: timestampUs })
      bitmap.close()
      return out
    },
    dispose(): void {},
  }
}

interface Canvas2dWrapOptions {
  variantName: string
  smoothing: boolean
  smoothingQuality: "low" | "medium" | "high"
}

function makeCanvas2dWrapTechnique(opts: Canvas2dWrapOptions): Technique {
  let canvas: OffscreenCanvas | null = null
  let context: OffscreenCanvasRenderingContext2D | null = null
  return {
    name: opts.variantName,
    async setup(): Promise<void> {
      canvas = new OffscreenCanvas(
        params.targetResolution.width,
        params.targetResolution.height,
      )
      const ctx = canvas.getContext("2d")
      if (ctx === null) {
        throw new Error(`${opts.variantName}: no 2d context`)
      }
      ctx.imageSmoothingEnabled = opts.smoothing
      ctx.imageSmoothingQuality = opts.smoothingQuality
      context = ctx
    },
    async resize(frame: VideoFrame, timestampUs: number): Promise<VideoFrame> {
      if (canvas === null || context === null) {
        throw new Error(`${opts.variantName}: not set up`)
      }
      context.drawImage(
        frame,
        0,
        0,
        params.targetResolution.width,
        params.targetResolution.height,
      )
      return new VideoFrame(canvas, { timestamp: timestampUs })
    },
    dispose(): void {
      canvas = null
      context = null
    },
  }
}

function makeCanvas2dTransferTechnique(): Technique {
  let canvas: OffscreenCanvas | null = null
  let context: OffscreenCanvasRenderingContext2D | null = null
  return {
    name: "canvas2d-transfer",
    async setup(): Promise<void> {
      canvas = new OffscreenCanvas(
        params.targetResolution.width,
        params.targetResolution.height,
      )
      const ctx = canvas.getContext("2d")
      if (ctx === null) {
        throw new Error("canvas2d-transfer: no 2d context")
      }
      ctx.imageSmoothingQuality = "low"
      context = ctx
    },
    async resize(frame: VideoFrame, timestampUs: number): Promise<VideoFrame> {
      if (canvas === null || context === null) {
        throw new Error("canvas2d-transfer: not set up")
      }
      context.drawImage(
        frame,
        0,
        0,
        params.targetResolution.width,
        params.targetResolution.height,
      )
      const bitmap = canvas.transferToImageBitmap()
      const out = new VideoFrame(bitmap, { timestamp: timestampUs })
      bitmap.close()
      return out
    },
    dispose(): void {
      canvas = null
      context = null
    },
  }
}

const WEBGL_VERTEX = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2((a_pos.x + 1.0) * 0.5, (1.0 - a_pos.y) * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`
const WEBGL_FRAGMENT = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 outColor;
void main() {
  outColor = texture(u_tex, v_uv);
}
`

interface WebglVariantOptions {
  variantName: string
  // sync: call gl.finish() before measuring (closest to real per-frame cost)
  sync: boolean
  // outputMode:
  //   'canvas-wrap'    — render to the GL canvas; wrap canvas as VideoFrame
  //   'canvas-transfer'— render to canvas, transferToImageBitmap, wrap bitmap
  outputMode: "canvas-wrap" | "canvas-transfer"
  // useMipmaps: generate mip levels after upload, sample with linear-mipmap-linear.
  // Higher-quality downscale at the cost of mip generation.
  useMipmaps: boolean
}

function makeWebglTechnique(opts: WebglVariantOptions): Technique {
  let canvas: OffscreenCanvas | null = null
  let gl: WebGL2RenderingContext | null = null
  let texture: WebGLTexture | null = null
  return {
    name: opts.variantName,
    async setup(): Promise<void> {
      canvas = new OffscreenCanvas(
        params.targetResolution.width,
        params.targetResolution.height,
      )
      const ctx = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: true })
      if (ctx === null) {
        throw new Error(`${opts.variantName}: WebGL2 unavailable`)
      }
      gl = ctx
      const vs = gl.createShader(gl.VERTEX_SHADER)
      if (vs === null) {
        throw new Error(`${opts.variantName}: createShader vs`)
      }
      gl.shaderSource(vs, WEBGL_VERTEX)
      gl.compileShader(vs)
      if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
        throw new Error(`${opts.variantName}: vs compile ${gl.getShaderInfoLog(vs) ?? ""}`)
      }
      const fs = gl.createShader(gl.FRAGMENT_SHADER)
      if (fs === null) {
        throw new Error(`${opts.variantName}: createShader fs`)
      }
      gl.shaderSource(fs, WEBGL_FRAGMENT)
      gl.compileShader(fs)
      if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
        throw new Error(`${opts.variantName}: fs compile ${gl.getShaderInfoLog(fs) ?? ""}`)
      }
      const program = gl.createProgram()
      if (program === null) {
        throw new Error(`${opts.variantName}: createProgram`)
      }
      gl.attachShader(program, vs)
      gl.attachShader(program, fs)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`${opts.variantName}: link ${gl.getProgramInfoLog(program) ?? ""}`)
      }
      gl.useProgram(program)

      const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
      const buf = gl.createBuffer()
      gl.bindBuffer(gl.ARRAY_BUFFER, buf)
      gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW)
      const aPos = gl.getAttribLocation(program, "a_pos")
      gl.enableVertexAttribArray(aPos)
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

      texture = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const minFilter = opts.useMipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, minFilter)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

      gl.viewport(0, 0, params.targetResolution.width, params.targetResolution.height)
    },
    async resize(frame: VideoFrame, timestampUs: number): Promise<VideoFrame> {
      if (gl === null || canvas === null || texture === null) {
        throw new Error(`${opts.variantName}: not set up`)
      }
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame)
      if (opts.useMipmaps) {
        gl.generateMipmap(gl.TEXTURE_2D)
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      if (opts.sync) {
        gl.finish()
      }
      if (opts.outputMode === "canvas-transfer") {
        const bitmap = canvas.transferToImageBitmap()
        const out = new VideoFrame(bitmap, { timestamp: timestampUs })
        bitmap.close()
        return out
      }
      return new VideoFrame(canvas, { timestamp: timestampUs })
    },
    dispose(): void {
      gl = null
      texture = null
      canvas = null
    },
  }
}

interface WebGPUNavigator {
  gpu?: {
    requestAdapter(): Promise<{
      requestDevice(): Promise<unknown>
    } | null>
  }
}

function isWebGPUAvailable(): boolean {
  return (navigator as unknown as WebGPUNavigator).gpu !== undefined
}

interface WebgpuVariantOptions {
  variantName: string
  // sync: await queue.onSubmittedWorkDone() so the per-call cost reflects
  // total GPU work, not just JS dispatch. Set false for throughput-style
  // measurement.
  sync: boolean
  // sourceMode:
  //   'external'    — import VideoFrame as external texture (fast in theory; slow in practice on this device)
  //   'copy-then-2d'— copyExternalImageToTexture into a regular 2D texture; render from that
  sourceMode: "external" | "copy-then-2d"
  // pipelineMode:
  //   'render'  — full-screen quad render pass into the canvas
  //   'compute' — compute pass writing into a storage texture, blitted to canvas
  pipelineMode: "render" | "compute"
}

interface WebgpuRig {
  device: GPUDevice
  canvas: OffscreenCanvas
  context: GPUCanvasContext
  format: GPUTextureFormat
  renderPipeline: GPURenderPipeline | null
  computePipeline: GPUComputePipeline | null
  blitPipeline: GPURenderPipeline | null
  sampler: GPUSampler
  copyTexture: GPUTexture | null
  computeOutputTexture: GPUTexture | null
}

function makeWebgpuTechnique(opts: WebgpuVariantOptions): Technique {
  let rig: WebgpuRig | null = null
  return {
    name: opts.variantName,
    async setup(): Promise<void> {
      const navGpu = (navigator as unknown as { gpu: GPU }).gpu
      if (navGpu === undefined) {
        throw new Error(`${opts.variantName}: navigator.gpu unavailable`)
      }
      const adapter = await navGpu.requestAdapter()
      if (adapter === null) {
        throw new Error(`${opts.variantName}: no adapter`)
      }
      const device = (await adapter.requestDevice()) as GPUDevice
      const canvas = new OffscreenCanvas(
        params.targetResolution.width,
        params.targetResolution.height,
      )
      const ctx = canvas.getContext("webgpu") as GPUCanvasContext | null
      if (ctx === null) {
        throw new Error(`${opts.variantName}: no canvas context`)
      }
      const format = navGpu.getPreferredCanvasFormat()
      ctx.configure({ device, format, alphaMode: "premultiplied" })
      const sampler = device.createSampler({ magFilter: "linear", minFilter: "linear" })

      // Render-from-external-texture program (used when sourceMode==='external').
      const externalShader = device.createShaderModule({
        code: `
          struct VertexOutput {
            @builtin(position) position: vec4f,
            @location(0) uv: vec2f,
          };
          @vertex
          fn vs(@builtin(vertex_index) index: u32) -> VertexOutput {
            var pos = array<vec2f, 4>(
              vec2f(-1.0, -1.0),
              vec2f( 1.0, -1.0),
              vec2f(-1.0,  1.0),
              vec2f( 1.0,  1.0),
            );
            var uv = array<vec2f, 4>(
              vec2f(0.0, 1.0),
              vec2f(1.0, 1.0),
              vec2f(0.0, 0.0),
              vec2f(1.0, 0.0),
            );
            var out: VertexOutput;
            out.position = vec4f(pos[index], 0.0, 1.0);
            out.uv = uv[index];
            return out;
          }
          @group(0) @binding(0) var s: sampler;
          @group(0) @binding(1) var t: texture_external;
          @fragment
          fn fs(in: VertexOutput) -> @location(0) vec4f {
            return textureSampleBaseClampToEdge(t, s, in.uv);
          }
        `,
      })
      // Render-from-2d-texture program (used when sourceMode==='copy-then-2d',
      // and as the blit-out program after compute).
      const twoDShader = device.createShaderModule({
        code: `
          struct VertexOutput {
            @builtin(position) position: vec4f,
            @location(0) uv: vec2f,
          };
          @vertex
          fn vs(@builtin(vertex_index) index: u32) -> VertexOutput {
            var pos = array<vec2f, 4>(
              vec2f(-1.0, -1.0),
              vec2f( 1.0, -1.0),
              vec2f(-1.0,  1.0),
              vec2f( 1.0,  1.0),
            );
            var uv = array<vec2f, 4>(
              vec2f(0.0, 1.0),
              vec2f(1.0, 1.0),
              vec2f(0.0, 0.0),
              vec2f(1.0, 0.0),
            );
            var out: VertexOutput;
            out.position = vec4f(pos[index], 0.0, 1.0);
            out.uv = uv[index];
            return out;
          }
          @group(0) @binding(0) var s: sampler;
          @group(0) @binding(1) var t: texture_2d<f32>;
          @fragment
          fn fs(in: VertexOutput) -> @location(0) vec4f {
            return textureSample(t, s, in.uv);
          }
        `,
      })

      let renderPipeline: GPURenderPipeline | null = null
      let blitPipeline: GPURenderPipeline | null = null
      let computePipeline: GPUComputePipeline | null = null
      let copyTexture: GPUTexture | null = null
      let computeOutputTexture: GPUTexture | null = null

      if (opts.pipelineMode === "render") {
        const shaderModule = opts.sourceMode === "external" ? externalShader : twoDShader
        renderPipeline = device.createRenderPipeline({
          layout: "auto",
          vertex: { module: shaderModule, entryPoint: "vs" },
          fragment: { module: shaderModule, entryPoint: "fs", targets: [{ format }] },
          primitive: { topology: "triangle-strip" },
        })
      } else {
        // Compute pipeline: read from a 2d texture (source mode must be copy-then-2d
        // because texture_external is not directly samplable in a compute pass).
        const computeShader = device.createShaderModule({
          code: `
            @group(0) @binding(0) var s: sampler;
            @group(0) @binding(1) var src: texture_2d<f32>;
            @group(0) @binding(2) var dst: texture_storage_2d<rgba8unorm, write>;
            @compute @workgroup_size(8, 8)
            fn cs(@builtin(global_invocation_id) gid: vec3u) {
              let dim = textureDimensions(dst);
              if (gid.x >= dim.x || gid.y >= dim.y) {
                return;
              }
              let uv = vec2f(f32(gid.x) / f32(dim.x), f32(gid.y) / f32(dim.y));
              let color = textureSampleLevel(src, s, uv, 0.0);
              textureStore(dst, vec2i(i32(gid.x), i32(gid.y)), color);
            }
          `,
        })
        computePipeline = device.createComputePipeline({
          layout: "auto",
          compute: { module: computeShader, entryPoint: "cs" },
        })
        // Compute writes to a storage texture; blit pipeline copies it onto the canvas.
        blitPipeline = device.createRenderPipeline({
          layout: "auto",
          vertex: { module: twoDShader, entryPoint: "vs" },
          fragment: { module: twoDShader, entryPoint: "fs", targets: [{ format }] },
          primitive: { topology: "triangle-strip" },
        })
        computeOutputTexture = device.createTexture({
          size: {
            width: params.targetResolution.width,
            height: params.targetResolution.height,
          },
          format: "rgba8unorm",
          // STORAGE_BINDING (0x08) | TEXTURE_BINDING (0x04) | COPY_SRC (0x01)
          usage: 0x08 | 0x04 | 0x01,
        })
      }

      // copyTexture is created lazily on first resize() call so it
      // matches the actual frame size (camera may negotiate a different
      // resolution than requested).
      rig = {
        device,
        canvas,
        context: ctx,
        format,
        renderPipeline,
        computePipeline,
        blitPipeline,
        sampler,
        copyTexture,
        computeOutputTexture,
      }
    },
    async resize(frame: VideoFrame, timestampUs: number): Promise<VideoFrame> {
      if (rig === null) {
        throw new Error(`${opts.variantName}: not set up`)
      }
      const { device, canvas, context, sampler } = rig
      let sourceTextureView: GPUTextureView | GPUExternalTexture
      if (opts.sourceMode === "external") {
        sourceTextureView = device.importExternalTexture({ source: frame })
      } else {
        // Size copyTexture to match the actual frame on first use.
        if (
          rig.copyTexture === null ||
          rig.copyTexture.width !== frame.codedWidth ||
          rig.copyTexture.height !== frame.codedHeight
        ) {
          if (rig.copyTexture !== null) {
            rig.copyTexture.destroy()
          }
          rig.copyTexture = device.createTexture({
            size: { width: frame.codedWidth, height: frame.codedHeight },
            format: "rgba8unorm",
            // COPY_DST | TEXTURE_BINDING | RENDER_ATTACHMENT
            usage: 0x02 | 0x04 | 0x10,
          })
        }
        device.queue.copyExternalImageToTexture(
          { source: frame },
          { texture: rig.copyTexture },
          [frame.codedWidth, frame.codedHeight],
        )
        sourceTextureView = rig.copyTexture.createView()
      }

      const commandEncoder = device.createCommandEncoder()

      if (opts.pipelineMode === "render") {
        if (rig.renderPipeline === null) {
          throw new Error(`${opts.variantName}: renderPipeline missing`)
        }
        const bindGroup = device.createBindGroup({
          layout: rig.renderPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: sourceTextureView },
          ],
        })
        const pass = commandEncoder.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        })
        pass.setPipeline(rig.renderPipeline)
        pass.setBindGroup(0, bindGroup)
        pass.draw(4, 1, 0, 0)
        pass.end()
      } else {
        if (
          rig.computePipeline === null ||
          rig.blitPipeline === null ||
          rig.computeOutputTexture === null
        ) {
          throw new Error(`${opts.variantName}: compute resources missing`)
        }
        const computeBindGroup = device.createBindGroup({
          layout: rig.computePipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: sourceTextureView },
            { binding: 2, resource: rig.computeOutputTexture.createView() },
          ],
        })
        const computePass = commandEncoder.beginComputePass()
        computePass.setPipeline(rig.computePipeline)
        computePass.setBindGroup(0, computeBindGroup)
        const wx = Math.ceil(params.targetResolution.width / 8)
        const wy = Math.ceil(params.targetResolution.height / 8)
        computePass.dispatchWorkgroups(wx, wy)
        computePass.end()

        const blitBindGroup = device.createBindGroup({
          layout: rig.blitPipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: rig.computeOutputTexture.createView() },
          ],
        })
        const blitPass = commandEncoder.beginRenderPass({
          colorAttachments: [
            {
              view: context.getCurrentTexture().createView(),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        })
        blitPass.setPipeline(rig.blitPipeline)
        blitPass.setBindGroup(0, blitBindGroup)
        blitPass.draw(4, 1, 0, 0)
        blitPass.end()
      }
      device.queue.submit([commandEncoder.finish()])
      if (opts.sync) {
        await device.queue.onSubmittedWorkDone()
      }
      return new VideoFrame(canvas, { timestamp: timestampUs })
    },
    dispose(): void {
      rig = null
    },
  }
}

// Cost-of-nothing baseline: clone the source VideoFrame at native res
// without resizing. Establishes the floor on per-call overhead any
// real resize technique must beat.
function makePassthroughTechnique(): Technique {
  return {
    name: "passthrough-clone",
    validateEncode: false,
    async setup(): Promise<void> {},
    async resize(frame: VideoFrame, _timestampUs: number): Promise<VideoFrame> {
      return frame.clone()
    },
    dispose(): void {},
  }
}

interface PerTechniqueState {
  timings: number[]
  setupMs: number
  available: boolean
  skippedReason: string | null
  encoderRig: {
    output: Output
    source: VideoSampleSource
    pendingAdds: number
    framesSubmitted: number
    framesEncoded: number
    errors: string[]
  } | null
  errors: string[]
}

async function makeEncoderRig(): Promise<PerTechniqueState["encoderRig"]> {
  const output = new Output({ format: new WebMOutputFormat(), target: new BufferTarget() })
  const bitrate = Math.round(
    params.targetResolution.width *
      params.targetResolution.height *
      params.targetFps *
      params.bitratePerPixel,
  )
  const source = new VideoSampleSource({ codec: params.codec, bitrate })
  output.addVideoTrack(source)
  await output.start()
  return {
    output,
    source,
    pendingAdds: 0,
    framesSubmitted: 0,
    framesEncoded: 0,
    errors: [],
  }
}

async function run(): Promise<void> {
  status(`resize-shootout: ${params.targetFrames} frames @ ${params.sourceResolution.width}×${params.sourceResolution.height} → ${params.targetResolution.width}×${params.targetResolution.height}`)
  status("opening camera…")
  const stream = await navigator.mediaDevices.getUserMedia({
    video: {
      width: params.sourceResolution.width,
      height: params.sourceResolution.height,
    },
    audio: false,
  })
  const [track] = stream.getVideoTracks()
  if (track === undefined) {
    throw new Error("run: no camera track")
  }
  const settings = track.getSettings()
  status(`  camera native ${settings.width}×${settings.height} @ ${settings.frameRate ?? "?"} fps`)

  const techniques: Technique[] = [
    makePassthroughTechnique(),
    makeCreateImageBitmapTechnique("low"),
    makeCreateImageBitmapTechnique("medium"),
    makeCreateImageBitmapTechnique("high"),
    makeCanvas2dWrapTechnique({
      variantName: "canvas2d-wrap-low",
      smoothing: true,
      smoothingQuality: "low",
    }),
    makeCanvas2dWrapTechnique({
      variantName: "canvas2d-wrap-high",
      smoothing: true,
      smoothingQuality: "high",
    }),
    makeCanvas2dWrapTechnique({
      variantName: "canvas2d-wrap-nosmooth",
      smoothing: false,
      smoothingQuality: "low",
    }),
    makeCanvas2dTransferTechnique(),
    makeWebglTechnique({
      variantName: "webgl-canvas-wrap-sync",
      sync: true,
      outputMode: "canvas-wrap",
      useMipmaps: false,
    }),
    makeWebglTechnique({
      variantName: "webgl-canvas-wrap-nosync",
      sync: false,
      outputMode: "canvas-wrap",
      useMipmaps: false,
    }),
    makeWebglTechnique({
      variantName: "webgl-mipmap-sync",
      sync: true,
      outputMode: "canvas-wrap",
      useMipmaps: true,
    }),
    makeWebglTechnique({
      variantName: "webgl-canvas-transfer-sync",
      sync: true,
      outputMode: "canvas-transfer",
      useMipmaps: false,
    }),
  ]
  if (isWebGPUAvailable()) {
    techniques.push(
      makeWebgpuTechnique({
        variantName: "webgpu-render-external-sync",
        sync: true,
        sourceMode: "external",
        pipelineMode: "render",
      }),
      makeWebgpuTechnique({
        variantName: "webgpu-render-external-nosync",
        sync: false,
        sourceMode: "external",
        pipelineMode: "render",
      }),
      makeWebgpuTechnique({
        variantName: "webgpu-render-copy2d-sync",
        sync: true,
        sourceMode: "copy-then-2d",
        pipelineMode: "render",
      }),
      makeWebgpuTechnique({
        variantName: "webgpu-compute-copy2d-sync",
        sync: true,
        sourceMode: "copy-then-2d",
        pipelineMode: "compute",
      }),
    )
  } else {
    status("  webgpu: navigator.gpu unavailable — skipping all webgpu variants")
  }

  const states = new Map<string, PerTechniqueState>()
  for (const t of techniques) {
    status(`setup: ${t.name}`)
    const start = performance.now()
    try {
      await t.setup()
      const encoderRig =
        t.validateEncode === false ? null : await makeEncoderRig()
      states.set(t.name, {
        timings: [],
        setupMs: performance.now() - start,
        available: true,
        skippedReason: null,
        encoderRig,
        errors: [],
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      states.set(t.name, {
        timings: [],
        setupMs: performance.now() - start,
        available: false,
        skippedReason: message,
        encoderRig: null,
        errors: [message],
      })
      status(`  ${t.name}: setup failed — ${message}`)
    }
  }

  const Ctor = (window as unknown as {
    MediaStreamTrackProcessor: new (init: { track: MediaStreamTrack }) => {
      readable: ReadableStream<VideoFrame>
    }
  }).MediaStreamTrackProcessor
  const processor = new Ctor({ track })
  const reader = processor.readable.getReader()

  let framesCaptured = 0
  while (framesCaptured < params.targetFrames) {
    const { value, done } = await reader.read()
    if (done) {
      break
    }
    framesCaptured++
    const timestampUs = value.timestamp
    for (const t of techniques) {
      const state = states.get(t.name)
      if (state === undefined || !state.available) {
        continue
      }
      const start = performance.now()
      try {
        const out = await t.resize(value, timestampUs)
        const ms = performance.now() - start
        state.timings.push(ms)
        // Encode the first validateEncodeFrames frames to test round-trip.
        if (
          state.encoderRig !== null &&
          state.encoderRig.framesSubmitted < params.validateEncodeFrames
        ) {
          const sample = new VideoSample(out)
          state.encoderRig.framesSubmitted++
          state.encoderRig.pendingAdds++
          const rig = state.encoderRig
          rig.source
            .add(sample)
            .then(() => {
              rig.framesEncoded++
            })
            .catch((error: unknown) => {
              rig.errors.push(error instanceof Error ? error.message : String(error))
            })
            .finally(() => {
              rig.pendingAdds--
              sample.close()
            })
        } else {
          out.close()
        }
      } catch (error) {
        state.errors.push(error instanceof Error ? error.message : String(error))
      }
    }
    value.close()
    if (framesCaptured % 30 === 0) {
      status(`  captured ${framesCaptured}/${params.targetFrames}`)
    }
  }
  try {
    reader.releaseLock()
  } catch {}
  try {
    track.stop()
  } catch {}

  // Drain + finalize every encoder, then verify round-trip.
  const results: TechniqueResult[] = []
  for (const t of techniques) {
    const state = states.get(t.name)
    if (state === undefined) {
      continue
    }
    let encodeRoundTripDemuxed = 0
    let encodeRoundTripOk = false
    let encodeFramesEncoded = 0
    let encodeFramesSubmitted = 0
    if (state.encoderRig !== null) {
      const rig = state.encoderRig
      const drainStart = performance.now()
      while (rig.pendingAdds > 0) {
        await wait(10)
        if (performance.now() - drainStart > 30_000) {
          rig.errors.push(`drain: still ${rig.pendingAdds} pending`)
          break
        }
      }
      rig.source.close()
      try {
        await rig.output.finalize()
      } catch (error) {
        rig.errors.push(`finalize: ${error instanceof Error ? error.message : String(error)}`)
      }
      const buffer = (rig.output.target as BufferTarget).buffer
      if (buffer !== null) {
        try {
          const blob = new Blob([buffer], { type: "video/webm" })
          const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) })
          const videoTracks = await input.getVideoTracks()
          const videoTrack = videoTracks[0] ?? null
          if (videoTrack !== null) {
            const sink = new EncodedPacketSink(videoTrack)
            for await (const _packet of sink.packets()) {
              encodeRoundTripDemuxed++
            }
            encodeRoundTripOk = encodeRoundTripDemuxed === rig.framesEncoded
          }
        } catch (error) {
          rig.errors.push(`roundtrip: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      encodeFramesEncoded = rig.framesEncoded
      encodeFramesSubmitted = rig.framesSubmitted
      state.errors.push(...rig.errors)
    }
    t.dispose()
    const sorted = state.timings.slice().sort((a, b) => a - b)
    const p50Idx = Math.floor(sorted.length * 0.5)
    const p95Idx = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))
    results.push({
      name: t.name,
      setupMs: state.setupMs,
      samples: state.timings.length,
      p50Ms: sorted.length > 0 ? sorted[p50Idx] : 0,
      p95Ms: sorted.length > 0 ? sorted[p95Idx] : 0,
      maxMs: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
      encodeFramesSubmitted,
      encodeFramesEncoded,
      encodeRoundTripDemuxed,
      encodeRoundTripOk,
      available: state.available,
      skippedReason: state.skippedReason,
      errors: state.errors,
    })
    status(
      `  ${t.name.padEnd(28)} p50=${sorted.length > 0 ? sorted[p50Idx].toFixed(2) : "-"}ms p95=${sorted.length > 0 ? sorted[p95Idx].toFixed(2) : "-"}ms max=${sorted.length > 0 ? sorted[sorted.length - 1].toFixed(2) : "-"}ms roundTrip=${encodeRoundTripOk ? "ok" : "FAIL"}`,
    )
  }

  status("done.")
  reportResult("resize-shootout", params, {
    cameraSettings: {
      width: settings.width ?? null,
      height: settings.height ?? null,
      frameRate: settings.frameRate ?? null,
    },
    framesCaptured,
    techniques: results,
  })
}

run().catch((error: unknown) => {
  status(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  reportResult("resize-shootout", params, {
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  })
})
