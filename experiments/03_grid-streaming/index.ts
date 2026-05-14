// grid-streaming — does the *real* streaming workload sustain realtime?
//
// decoder-pools tested K decoders each on a full 720p stream — but the
// real product isn't N full-res streams. It's ONE ~viewport-sized image
// subdivided into N cells, so each cell is ~viewport/N and the total
// decoded pixels stay roughly constant regardless of N.
//
// This sweeps grid sizes N: for each, record a clip at the cell size
// (viewport / √N per axis), run N decoders looping it concurrently, and
// measure per-decoder sustained fps. It isolates the question
// decoder-pools left ambiguous: is the bottleneck per-stream OVERHEAD
// (fixed per decoder → N small streams still bad → composite wins) or
// pixel BANDWIDTH (∝ pixels → N small streams summing to a viewport are
// fine → streaming works)?

import { recordProbeInput, type ProbeInput } from "../harness/input"
import { reportResult, status } from "../harness/report"
import { wait } from "../../src/utils"

const params = {
  // The A15's screen in device pixels (~384×699 CSS × ~2.8 dpr).
  totalResolution: { width: 1080, height: 1965 },
  // Square grids: cell = total / √N per axis.
  gridSizes: [4, 9, 16, 25],
  recordSeconds: 6,
  runSeconds: 6,
  maxQueue: 8,
  /** Per-decoder fps at/above this counts as keeping up with realtime. */
  realtimeFps: 28,
}

/** Decode `input`'s chunks on one decoder, looping until `deadline`,
 *  and resolve with the number of frames decoded. */
async function runOneDecoder(input: ProbeInput, deadline: number): Promise<number> {
  let decoded = 0
  const decoder = new VideoDecoder({
    output(frame) {
      decoded++
      frame.close()
    },
    error() {
      // a dead decoder just stops counting — surfaced as low fps
    },
  })
  decoder.configure(input.config)
  while (performance.now() < deadline) {
    for (const chunk of input.chunks) {
      if (performance.now() >= deadline) {
        break
      }
      decoder.decode(chunk)
      while (decoder.decodeQueueSize > params.maxQueue) {
        await wait(1)
      }
    }
    await decoder.flush()
    decoder.reset()
    decoder.configure(input.config)
  }
  decoder.close()
  return decoded
}

interface GridResult {
  n: number
  cell: { requested: string; actual: string }
  perDecoderFps: number[]
  minFps: number
  aggregateFps: number
  realtimeOk: boolean
}

async function measureGrid(n: number): Promise<GridResult> {
  const side = Math.sqrt(n)
  const cellWidth = Math.round(params.totalResolution.width / side)
  const cellHeight = Math.round(params.totalResolution.height / side)
  status(`N=${n}: recording ${cellWidth}x${cellHeight} cell clip...`)
  const input = await recordProbeInput(cellWidth, cellHeight, params.recordSeconds)
  status(`  got ${input.width}x${input.height}, ${input.chunks.length} chunks — running ${n} decoders...`)

  const deadline = performance.now() + params.runSeconds * 1000
  const start = performance.now()
  const counts = await Promise.all(
    Array.from({ length: n }, () => runOneDecoder(input, deadline)),
  )
  const elapsedSeconds = (performance.now() - start) / 1000

  const perDecoderFps = counts.map(count => count / elapsedSeconds)
  const minFps = Math.min(...perDecoderFps)
  const aggregateFps = perDecoderFps.reduce((sum, fps) => sum + fps, 0)
  const realtimeOk = minFps >= params.realtimeFps
  status(
    `  N=${n}: min=${minFps.toFixed(1)} fps  aggregate=${aggregateFps.toFixed(0)} fps  realtimeOk=${realtimeOk}`,
  )
  return {
    n,
    cell: {
      requested: `${cellWidth}x${cellHeight}`,
      actual: `${input.width}x${input.height}`,
    },
    perDecoderFps,
    minFps,
    aggregateFps,
    realtimeOk,
  }
}

async function run(): Promise<void> {
  const grids: GridResult[] = []
  for (const n of params.gridSizes) {
    grids.push(await measureGrid(n))
  }
  status("done.")
  reportResult("grid-streaming", params, { grids })
}

run().catch((error: unknown) => {
  status(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  reportResult("grid-streaming", params, {
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  })
})
