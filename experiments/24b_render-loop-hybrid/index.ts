// render-loop-hybrid — M atlas decoders + D per-cell dirty streams +
// (K-D) atlas-sampled cells. Tests how many dirty per-cell streams
// can coexist with the M-atlas baseline at K=16 before rAF saturates.

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
  bitratePerPixel: 0.1,
  swCodec: { label: "av1", codecString: "av01.0.04M.08" },
  /** Fix K=16, M=4 (2×2 cells per atlas), sweep D. */
  k: 16,
  m: 4,
  atlasCols: 2,
  atlasRows: 2,
  gridCols: 4,
  gridRows: 4,
  cellMip: { width: 480, height: 272 },
  dirtyCounts: [0, 2, 4, 8, 12],
}

interface MipAsset {
  width: number
  height: number
  config: VideoDecoderConfig
  chunks: EncodedVideoChunk[]
}

interface AtlasAsset extends MipAsset {
  atlasCols: number
  atlasRows: number
  cellWidth: number
  cellHeight: number
  buildMs: number
}

const snap16 = (value: number): number => Math.max(16, Math.round(value / 16) * 16)

async function transcodePerCellMip(
  source: ProbeInput,
  mipW: number,
  mipH: number,
): Promise<MipAsset | null> {
  const width = snap16(mipW)
  const height = snap16(mipH)
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext("2d")
  if (context === null) {
    return null
  }
  const chunks: EncodedVideoChunk[] = []
  let decoderConfig: VideoDecoderConfig | null = null
  const bitrate = Math.round(width * height * 30 * params.bitratePerPixel)
  const encoder = new VideoEncoder({
    output(chunk, metadata) {
      chunks.push(chunk)
      if (decoderConfig === null && metadata?.decoderConfig) {
        decoderConfig = metadata.decoderConfig
      }
    },
    error() {},
  })
  try {
    encoder.configure({
      codec: params.swCodec.codecString,
      width,
      height,
      bitrate,
      framerate: 30,
    })
  } catch {
    encoder.close()
    return null
  }
  let frameIdx = 0
  const sourceDecoder = new VideoDecoder({
    output(frame) {
      try {
        context.drawImage(frame, 0, 0, width, height)
        const scaled = new VideoFrame(canvas, { timestamp: frame.timestamp })
        encoder.encode(scaled, { keyFrame: frameIdx === 0 })
        scaled.close()
      } catch {}
      frame.close()
      frameIdx++
    },
    error() {},
  })
  sourceDecoder.configure(source.config)
  for (const chunk of source.chunks) {
    sourceDecoder.decode(chunk)
  }
  await sourceDecoder.flush()
  sourceDecoder.close()
  try {
    await encoder.flush()
  } catch {}
  encoder.close()
  if (chunks.length === 0 || decoderConfig === null) {
    return null
  }
  return { width, height, config: decoderConfig, chunks }
}

async function buildAtlas(
  source: ProbeInput,
  cellCols: number,
  cellRows: number,
  cellMipW: number,
  cellMipH: number,
): Promise<AtlasAsset | null> {
  const start = performance.now()
  const cellWidth = snap16(cellMipW)
  const cellHeight = snap16(cellMipH)
  const width = cellWidth * cellCols
  const height = cellHeight * cellRows
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext("2d")
  if (context === null) {
    return null
  }
  const chunks: EncodedVideoChunk[] = []
  let decoderConfig: VideoDecoderConfig | null = null
  const bitrate = Math.round(width * height * 30 * params.bitratePerPixel)
  const encoder = new VideoEncoder({
    output(chunk, metadata) {
      chunks.push(chunk)
      if (decoderConfig === null && metadata?.decoderConfig) {
        decoderConfig = metadata.decoderConfig
      }
    },
    error() {},
  })
  try {
    encoder.configure({
      codec: params.swCodec.codecString,
      width,
      height,
      bitrate,
      framerate: 30,
    })
  } catch {
    encoder.close()
    return null
  }
  let frameIdx = 0
  const sourceDecoder = new VideoDecoder({
    output(frame) {
      try {
        for (let row = 0; row < cellRows; row++) {
          for (let col = 0; col < cellCols; col++) {
            context.drawImage(frame, col * cellWidth, row * cellHeight, cellWidth, cellHeight)
          }
        }
        const atlasFrame = new VideoFrame(canvas, { timestamp: frame.timestamp })
        encoder.encode(atlasFrame, { keyFrame: frameIdx === 0 })
        atlasFrame.close()
      } catch {}
      frame.close()
      frameIdx++
    },
    error() {},
  })
  sourceDecoder.configure(source.config)
  for (const chunk of source.chunks) {
    sourceDecoder.decode(chunk)
  }
  await sourceDecoder.flush()
  sourceDecoder.close()
  try {
    await encoder.flush()
  } catch {}
  encoder.close()
  if (chunks.length === 0 || decoderConfig === null) {
    return null
  }
  return {
    width,
    height,
    cellWidth,
    cellHeight,
    atlasCols: cellCols,
    atlasRows: cellRows,
    config: decoderConfig,
    chunks,
    buildMs: performance.now() - start,
  }
}

interface PacedDecoder {
  latestFrame(): VideoFrame | null
  feedTo(elapsedMs: number, targetFps: number): void
  framesDecoded(): number
  stop(): void
}

function makePacedDecoder(asset: MipAsset): PacedDecoder {
  let latest: VideoFrame | null = null
  let cursor = 0
  let framesDecoded = 0
  const decoder = new VideoDecoder({
    output(frame) {
      framesDecoded++
      if (latest !== null) {
        latest.close()
      }
      latest = frame
    },
    error() {},
  })
  try {
    decoder.configure({ ...asset.config, hardwareAcceleration: "prefer-software" })
  } catch {}
  return {
    latestFrame: () => latest,
    framesDecoded: () => framesDecoded,
    feedTo(elapsedMs, targetFps) {
      const targetCursor = Math.floor((elapsedMs * targetFps) / 1000) + 1
      while (cursor < targetCursor && decoder.decodeQueueSize < 4) {
        const chunkIdx = cursor % asset.chunks.length
        decoder.decode(asset.chunks[chunkIdx])
        cursor++
      }
    },
    stop() {
      if (latest !== null) {
        latest.close()
        latest = null
      }
      try {
        decoder.close()
      } catch {}
    },
  }
}

interface CellSpec {
  /** Index into the textures array (M atlas textures, then D per-cell). */
  textureIndex: number
  /** Index into the decoders array (M atlas decoders, then D per-cell). */
  decoderIndex: number
  ndcX: number
  ndcY: number
  ndcW: number
  ndcH: number
  /** UV transform: per-cell streams use (0,0)+(1,1); atlas cells use sub-rect. */
  uvOffsetX: number
  uvOffsetY: number
  uvScaleX: number
  uvScaleY: number
}

/** Build cell specs: K cells total in a gridCols×gridRows viewport.
 *  First D cells render from their own per-cell decoder/texture; the
 *  remaining (K-D) sample from atlas sub-rects (round-robin atlas
 *  assignment for the atlas-sourced cells). */
function buildCellSpecs(
  k: number,
  gridCols: number,
  gridRows: number,
  m: number,
  atlasCols: number,
  atlasRows: number,
  d: number,
): CellSpec[] {
  const cells: CellSpec[] = []
  const viewportCellW = 2 / gridCols
  const viewportCellH = 2 / gridRows
  const atlasCellsPerAtlas = atlasCols * atlasRows
  const perAtlasCounts = new Array<number>(m).fill(0)
  for (let i = 0; i < k; i++) {
    const row = Math.floor(i / gridCols)
    const col = i % gridCols
    const ndcX = -1 + col * viewportCellW
    const ndcY = 1 - (row + 1) * viewportCellH
    if (i < d) {
      // Dirty cell — own per-cell decoder/texture, full UV.
      cells.push({
        textureIndex: m + i,
        decoderIndex: m + i,
        ndcX,
        ndcY,
        ndcW: viewportCellW,
        ndcH: viewportCellH,
        uvOffsetX: 0,
        uvOffsetY: 0,
        uvScaleX: 1,
        uvScaleY: 1,
      })
    } else {
      // Atlas-sourced cell — assign to next available atlas slot.
      const atlasIndex = (i - d) % m
      const slotInAtlas = perAtlasCounts[atlasIndex]++
      if (slotInAtlas >= atlasCellsPerAtlas) {
        throw new Error(
          `cell ${i} → atlas ${atlasIndex} slot ${slotInAtlas} exceeds capacity ${atlasCellsPerAtlas}`,
        )
      }
      const tileRow = Math.floor(slotInAtlas / atlasCols)
      const tileCol = slotInAtlas % atlasCols
      cells.push({
        textureIndex: atlasIndex,
        decoderIndex: atlasIndex,
        ndcX,
        ndcY,
        ndcW: viewportCellW,
        ndcH: viewportCellH,
        uvOffsetX: tileCol / atlasCols,
        uvOffsetY: 1 - (tileRow + 1) / atlasRows,
        uvScaleX: 1 / atlasCols,
        uvScaleY: 1 / atlasRows,
      })
    }
  }
  return cells
}

interface PassResult {
  d: number
  textureUploadsPerTick: number
  totalFramesDecoded: number
  aggregateDecodeFps: number
  jank: JankReport
  longTasks: LongTaskReport
}

async function runRenderLoop(
  atlases: AtlasAsset[],
  perCellMip: MipAsset,
  d: number,
): Promise<PassResult> {
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
uniform vec2 uUvOffset;
uniform vec2 uUvScale;
out vec2 vUv;
void main() {
  vec2 corner = (aQuad + 1.0) * 0.5;
  vec2 cornerFlipY = vec2(corner.x, 1.0 - corner.y);
  vUv = uUvOffset + cornerFlipY * uUvScale;
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
  const uUvOffset = gl.getUniformLocation(program, "uUvOffset")
  const uUvScale = gl.getUniformLocation(program, "uUvScale")

  // Decoders: [...M atlas, ...D per-cell].
  const atlasDecoders = atlases.map(makePacedDecoder)
  const perCellDecoders = Array.from({ length: d }, () => makePacedDecoder(perCellMip))
  const decoders: PacedDecoder[] = [...atlasDecoders, ...perCellDecoders]
  const textures = decoders.map(() => {
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  })
  const cells = buildCellSpecs(
    params.k,
    params.gridCols,
    params.gridRows,
    params.m,
    params.atlasCols,
    params.atlasRows,
    d,
  )

  const recorder = new JankRecorder()
  const longTasks = observeLongTasks()
  const deadline = performance.now() + params.runSeconds * 1000
  const startWall = performance.now()
  const targetFps = 30

  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight)

  await new Promise<void>(resolveLoop => {
    function tick(now: number) {
      if (now >= deadline) {
        resolveLoop()
        return
      }
      recorder.mark(now)
      const elapsedMs = now - startWall
      for (const decoder of decoders) {
        decoder.feedTo(elapsedMs, targetFps)
      }
      gl.clear(gl.COLOR_BUFFER_BIT)
      for (let i = 0; i < decoders.length; i++) {
        const frame = decoders[i].latestFrame()
        if (frame === null) {
          continue
        }
        gl.bindTexture(gl.TEXTURE_2D, textures[i])
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame)
      }
      let lastBound = -1
      for (const cell of cells) {
        if (cell.textureIndex !== lastBound) {
          gl.bindTexture(gl.TEXTURE_2D, textures[cell.textureIndex])
          lastBound = cell.textureIndex
        }
        gl.uniform2f(uNdcOffset, cell.ndcX, cell.ndcY)
        gl.uniform2f(uNdcScale, cell.ndcW, cell.ndcH)
        gl.uniform2f(uUvOffset, cell.uvOffsetX, cell.uvOffsetY)
        gl.uniform2f(uUvScale, cell.uvScaleX, cell.uvScaleY)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  const longTaskReport = longTasks.stop()
  const jank = recorder.snapshot()
  const totalFramesDecoded = decoders.reduce((s, dec) => s + dec.framesDecoded(), 0)
  const elapsedSec = (performance.now() - startWall) / 1000

  for (const decoder of decoders) {
    decoder.stop()
  }
  for (const tex of textures) {
    gl.deleteTexture(tex)
  }
  gl.deleteBuffer(buffer)
  gl.deleteProgram(program)
  gl.deleteShader(vs)
  gl.deleteShader(fs)
  document.body.removeChild(canvas)

  return {
    d,
    textureUploadsPerTick: atlases.length + d,
    totalFramesDecoded,
    aggregateDecodeFps: totalFramesDecoded / elapsedSec,
    jank,
    longTasks: longTaskReport,
  }
}

async function run(): Promise<void> {
  status(`render-loop-hybrid: K=${params.k} M=${params.m} D ∈ ${JSON.stringify(params.dirtyCounts)}`)
  status(`recording VP8 source clip (${params.sourceSeconds}s)...`)
  const source = await recordProbeInput(
    params.captureResolution.width,
    params.captureResolution.height,
    params.sourceSeconds,
  )
  status(`  got ${source.width}x${source.height}, ${source.chunks.length} chunks`)

  status(`building ${params.m} AV1 atlases (${params.atlasCols}×${params.atlasRows} cells at ${params.cellMip.width}×${params.cellMip.height})...`)
  const atlases: AtlasAsset[] = []
  for (let i = 0; i < params.m; i++) {
    const asset = await buildAtlas(
      source,
      params.atlasCols,
      params.atlasRows,
      params.cellMip.width,
      params.cellMip.height,
    )
    if (asset === null) {
      status(`  atlas ${i} build FAILED — aborting`)
      reportResult("render-loop-hybrid", params, { error: "atlas build failed" })
      return
    }
    atlases.push(asset)
    status(`  atlas ${i}: ${asset.width}×${asset.height} ${asset.chunks.length} chunks (${asset.buildMs.toFixed(0)}ms)`)
  }

  status(`transcoding per-cell mip at ${params.cellMip.width}×${params.cellMip.height} AV1...`)
  const perCellMip = await transcodePerCellMip(source, params.cellMip.width, params.cellMip.height)
  if (perCellMip === null) {
    status(`  per-cell mip transcode FAILED — aborting`)
    reportResult("render-loop-hybrid", params, { error: "per-cell mip transcode failed" })
    return
  }
  status(`  per-cell mip: ${perCellMip.chunks.length} chunks`)

  const results: PassResult[] = []
  for (const d of params.dirtyCounts) {
    if (d > params.k) {
      status(`SKIP D=${d} > K=${params.k}`)
      continue
    }
    status(`PASS D=${d} → M+D=${params.m + d} texture uploads/tick`)
    const result = await runRenderLoop(atlases, perCellMip, d)
    results.push(result)
    status(
      `  fps=${(result.jank.framesObserved / params.runSeconds).toFixed(1)} ` +
        `mean=${result.jank.meanMs.toFixed(1)}ms p95=${result.jank.p95Ms.toFixed(1)}ms ` +
        `over33=${(result.jank.over33msRatio * 100).toFixed(1)}% ` +
        `streak=${result.jank.longestJankStreak} score=${result.jank.jankScore.toFixed(1)} ` +
        `decodeFps=${result.aggregateDecodeFps.toFixed(0)} ` +
        `longtasks=${result.longTasks.observed}`,
    )
  }
  status("done.")
  for (const atlas of atlases) {
    atlas.chunks.length = 0
  }
  perCellMip.chunks.length = 0
  reportResult("render-loop-hybrid", params, { passes: results })
}

run().catch((error: unknown) => {
  status(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  reportResult("render-loop-hybrid", params, {
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  })
})
