// decoder-pool-multi — N decoders, each time-slicing across
// cells_per_decoder cells. Validates 19's "decoder pool" architecture
// at the K=8 production target.
//
// Each decoder runs an independent scheduler loop; cells are
// statically assigned via round-robin. Renderer is source-fps-paced
// (per 19's fix) and shared across all cells.

import { wait } from "../../src/utils"
import { recordProbeInput, type ProbeInput } from "../harness/input"
import { JankRecorder, observeLongTasks, type JankReport, type LongTaskReport } from "../harness/jank"
import { reportResult, status } from "../harness/report"

const params = {
  captureResolution: { width: 1280, height: 720 },
  canvasResolution: { width: 540, height: 982 },
  sourceSeconds: 6,
  runSeconds: 6,
  batchSize: 30,
  refillThreshold: 21, // refill when buffer drops below ~21 frames (=
                       // 700ms remaining if drain rate is 30fps; gives
                       // headroom for the ~700ms refill batch)
  bufferCap: 30,
  sourceFps: 30,
  passes: [
    { n: 2, k: 4 },
    { n: 4, k: 8 },
    { n: 4, k: 12 },
  ],
}

interface Cell {
  id: number
  buffer: VideoFrame[]
  framesPaintedFromBuffer: number
  underflows: number
  lastFrameForRepaint: VideoFrame | null
  lastAdvancedAtMs: number
  /** Index of the decoder serving this cell. */
  decoderId: number
}

interface SwitchEvent {
  decoderId: number
  fromCell: number
  toCell: number
  pureSwitchMs: number
  batchMs: number
  framesDecoded: number
}

interface DecoderStats {
  id: number
  switches: number
  meanPureSwitchMs: number
  maxPureSwitchMs: number
  meanBatchMs: number
  framesDecoded: number
  decoderFps: number
  servingCells: number[]
}

interface PassReport {
  n: number
  k: number
  perDecoder: DecoderStats[]
  aggregateDecoderFps: number
  perCell: Array<{
    cellId: number
    decoderId: number
    framesPainted: number
    renderFps: number
    underflows: number
  }>
  totalUnderflows: number
  jank: JankReport
}

interface PainterHandle {
  setCellLayout(k: number): void
  paintCell(cellId: number, frame: VideoFrame | null): void
}

function makePainter(gl: WebGL2RenderingContext): PainterHandle {
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
  vUv = corner;
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
  const vbo = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo)
  gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW)
  const aQuad = gl.getAttribLocation(program, "aQuad")
  gl.enableVertexAttribArray(aQuad)
  gl.vertexAttribPointer(aQuad, 2, gl.FLOAT, false, 0, 0)
  const uNdcOffset = gl.getUniformLocation(program, "uNdcOffset")!
  const uNdcScale = gl.getUniformLocation(program, "uNdcScale")!
  function makeTex(): WebGLTexture {
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }
  const texPool: WebGLTexture[] = []
  let currentK = 0
  return {
    setCellLayout(k) {
      currentK = k
      while (texPool.length < k) {
        texPool.push(makeTex())
      }
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
    },
    paintCell(cellId, frame) {
      if (cellId === 0) {
        gl.clearColor(0, 0, 0, 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
      }
      if (frame === null) {
        return
      }
      const sliceH = 2 / currentK
      const ndcY = 1 - (cellId + 1) * sliceH
      gl.bindTexture(gl.TEXTURE_2D, texPool[cellId])
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, frame)
      gl.uniform2f(uNdcOffset, -1, ndcY)
      gl.uniform2f(uNdcScale, 2, sliceH)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    },
  }
}

async function runPass(
  sources: ProbeInput[],
  n: number,
  k: number,
  painter: PainterHandle,
): Promise<PassReport> {
  status(`PASS N=${n} decoders × K=${k} cells (~${(k / n).toFixed(1)} cells/decoder)`)
  painter.setCellLayout(k)

  const cells: Cell[] = Array.from({ length: k }, (_, id) => ({
    id,
    buffer: [],
    framesPaintedFromBuffer: 0,
    underflows: 0,
    lastFrameForRepaint: null,
    lastAdvancedAtMs: 0,
    decoderId: id % n,
  }))

  /** Per-decoder state. */
  interface DecoderSlot {
    id: number
    decoder: VideoDecoder
    cells: Cell[]
    activeCellId: number
    switches: SwitchEvent[]
    framesDecoded: number
    firstFrameOfBatchSeenAt: number
  }
  const slots: DecoderSlot[] = []
  for (let d = 0; d < n; d++) {
    const slot: DecoderSlot = {
      id: d,
      decoder: null as unknown as VideoDecoder, // set below
      cells: cells.filter(c => c.decoderId === d),
      activeCellId: -1,
      switches: [],
      framesDecoded: 0,
      firstFrameOfBatchSeenAt: -1,
    }
    slot.decoder = new VideoDecoder({
      output(frame) {
        if (slot.firstFrameOfBatchSeenAt < 0) {
          slot.firstFrameOfBatchSeenAt = performance.now()
        }
        if (slot.activeCellId >= 0) {
          const cell = cells[slot.activeCellId]
          if (cell.buffer.length < params.bufferCap) {
            cell.buffer.push(frame)
            slot.framesDecoded++
            return
          }
        }
        frame.close()
      },
      error(error) {
        console.error(`[decoder ${slot.id}] error:`, error.message ?? error)
      },
    })
    slots.push(slot)
  }

  let stop = false
  const jankRecorder = new JankRecorder()

  // Renderer: source-fps paced per cell (per 19's fix). rAF runs at
  // display rate but each cell only advances every 1/sourceFps.
  const sourceFrameIntervalMs = 1000 / params.sourceFps
  function tick() {
    if (stop) {
      return
    }
    jankRecorder.mark()
    const now = performance.now()
    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]
      const elapsedSinceAdvance = now - cell.lastAdvancedAtMs
      if (elapsedSinceAdvance >= sourceFrameIntervalMs) {
        const next = cell.buffer.shift()
        if (next !== undefined) {
          if (cell.lastFrameForRepaint !== null) {
            cell.lastFrameForRepaint.close()
          }
          cell.lastFrameForRepaint = next
          cell.framesPaintedFromBuffer++
          cell.lastAdvancedAtMs = now
          painter.paintCell(i, next)
          continue
        }
        cell.underflows++
      }
      if (cell.lastFrameForRepaint !== null) {
        painter.paintCell(i, cell.lastFrameForRepaint)
      } else {
        painter.paintCell(i, null)
      }
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)

  // Per-decoder scheduler: priority-pick the lowest-fill cell
  // assigned to this decoder; refill if below threshold.
  function startScheduler(slot: DecoderSlot): Promise<void> {
    return (async () => {
      while (!stop) {
        // Priority-pick: lowest-buffer cell from this decoder's assigned set.
        let target: Cell | null = null
        let lowestFill = Number.POSITIVE_INFINITY
        for (const cell of slot.cells) {
          if (cell.buffer.length < lowestFill) {
            lowestFill = cell.buffer.length
            target = cell
          }
        }
        if (target === null || lowestFill >= params.refillThreshold) {
          await wait(0)
          continue
        }
        const fromCell = slot.activeCellId
        const cellSource = sources[target.id]
        const switchStart = performance.now()
        slot.firstFrameOfBatchSeenAt = -1
        if (fromCell !== target.id) {
          slot.decoder.reset()
          slot.decoder.configure(cellSource.config)
        }
        slot.activeCellId = target.id
        const batchEnd = Math.min(params.batchSize, cellSource.chunks.length)
        for (let i = 0; i < batchEnd; i++) {
          slot.decoder.decode(cellSource.chunks[i])
        }
        // Race flush against stop + a timeout — flush sometimes
        // never resolves under contention; we don't want to hang
        // the whole pass on it.
        await Promise.race([
          slot.decoder.flush(),
          (async () => {
            while (!stop) {
              await wait(50)
            }
          })(),
          wait(2000),
        ])
        const elapsed = performance.now() - switchStart
        if (fromCell !== target.id) {
          const pureSwitchMs =
            slot.firstFrameOfBatchSeenAt > 0 ? slot.firstFrameOfBatchSeenAt - switchStart : elapsed
          slot.switches.push({
            decoderId: slot.id,
            fromCell,
            toCell: target.id,
            pureSwitchMs,
            batchMs: elapsed,
            framesDecoded: batchEnd,
          })
        }
        await wait(0)
      }
    })()
  }

  const schedulerPromises = slots.map(startScheduler)
  // Heartbeat every 1s so we can see progress live, not just at end.
  const passStart = performance.now()
  const heartbeat = window.setInterval(() => {
    const elapsed = ((performance.now() - passStart) / 1000).toFixed(1)
    const slotSummary = slots
      .map(s => `d${s.id}(${s.framesDecoded}f/${s.switches.length}sw)`)
      .join(" ")
    const cellSummary = cells.map(c => `c${c.id}=${c.buffer.length}`).join(" ")
    console.log(`[hb ${elapsed}s] ${slotSummary} | buffers: ${cellSummary}`)
  }, 1000)
  await wait(params.runSeconds * 1000)
  stop = true
  window.clearInterval(heartbeat)
  await Promise.all(schedulerPromises)
  await wait(50)

  // Cleanup
  for (const slot of slots) {
    slot.decoder.close()
  }
  for (const cell of cells) {
    for (const f of cell.buffer) {
      f.close()
    }
    if (cell.lastFrameForRepaint !== null) {
      cell.lastFrameForRepaint.close()
    }
  }

  const jank = jankRecorder.snapshot()
  const perDecoder: DecoderStats[] = slots.map(slot => {
    const switches = slot.switches
    const meanPureSwitchMs =
      switches.length === 0 ? 0 : switches.reduce((a, s) => a + s.pureSwitchMs, 0) / switches.length
    const maxPureSwitchMs =
      switches.length === 0 ? 0 : Math.max(...switches.map(s => s.pureSwitchMs))
    const meanBatchMs =
      switches.length === 0 ? 0 : switches.reduce((a, s) => a + s.batchMs, 0) / switches.length
    return {
      id: slot.id,
      switches: switches.length,
      meanPureSwitchMs,
      maxPureSwitchMs,
      meanBatchMs,
      framesDecoded: slot.framesDecoded,
      decoderFps: slot.framesDecoded / params.runSeconds,
      servingCells: slot.cells.map(c => c.id),
    }
  })
  return {
    n,
    k,
    perDecoder,
    aggregateDecoderFps: perDecoder.reduce((a, d) => a + d.decoderFps, 0),
    perCell: cells.map(c => ({
      cellId: c.id,
      decoderId: c.decoderId,
      framesPainted: c.framesPaintedFromBuffer,
      renderFps: c.framesPaintedFromBuffer / params.runSeconds,
      underflows: c.underflows,
    })),
    totalUnderflows: cells.reduce((a, c) => a + c.underflows, 0),
    jank,
  }
}

async function run(): Promise<void> {
  status(`decoder-pool-multi: passes=${JSON.stringify(params.passes)}, batch=${params.batchSize}`)
  const maxK = Math.max(...params.passes.map(p => p.k))
  status(`recording ${maxK} source clips × ${params.sourceSeconds}s each...`)
  const sources: ProbeInput[] = []
  for (let i = 0; i < maxK; i++) {
    status(`  recording clip ${i + 1}/${maxK}...`)
    sources.push(
      await recordProbeInput(
        params.captureResolution.width,
        params.captureResolution.height,
        params.sourceSeconds,
      ),
    )
  }
  status(`  got ${sources.length} sources, each ~${sources[0].chunks.length} chunks`)

  const canvas = document.createElement("canvas")
  canvas.width = params.canvasResolution.width
  canvas.height = params.canvasResolution.height
  document.body.appendChild(canvas)
  const glOrNull = canvas.getContext("webgl2")
  if (glOrNull === null) {
    throw new Error("no webgl2")
  }
  const painter = makePainter(glOrNull)

  const longtaskObserver = observeLongTasks()
  const reports: PassReport[] = []
  for (const { n, k } of params.passes) {
    const passSources = sources.slice(0, k)
    const report = await runPass(passSources, n, k, painter)
    reports.push(report)
    status(
      `  N=${n} K=${k}: aggregate=${report.aggregateDecoderFps.toFixed(1)}fps; ` +
        `underflows=${report.totalUnderflows}; jank score=${report.jank.jankScore.toFixed(1)} max=${report.jank.maxMs.toFixed(0)}ms`,
    )
    for (const dd of report.perDecoder) {
      status(
        `    decoder[${dd.id}] cells=[${dd.servingCells.join(",")}]: ${dd.decoderFps.toFixed(1)}fps, ` +
          `${dd.switches} switches, pureSwitch mean=${dd.meanPureSwitchMs.toFixed(1)}ms max=${dd.maxPureSwitchMs.toFixed(1)}ms`,
      )
    }
  }
  const longtasks = longtaskObserver.stop()
  document.body.removeChild(canvas)
  status("done.")
  reportResult("decoder-pool-multi", params, {
    passes: reports,
    longtasks: longtasks satisfies LongTaskReport,
  })
}

run().catch((error: unknown) => {
  status(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  reportResult("decoder-pool-multi", params, {
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  })
})
