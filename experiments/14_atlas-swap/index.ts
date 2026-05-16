// atlas-swap — measure handoff latency between two atlases. Cold
// (configure + first-decode happen at the swap moment) vs. hot
// (pre-warmed: decoder already holds the first frame, swap is a
// pointer flip).

import { wait } from "../../src/utils"
import { composite } from "../harness/composite"
import { recordProbeInput, type ProbeInput } from "../harness/input"
import { reportResult, status } from "../harness/report"

const params = {
  captureResolution: { width: 1280, height: 720 },
  atlasResolution: { width: 540, height: 983 },
  recordSeconds: 4,
  // Time to keep playing atlas A before triggering the swap. Long
  // enough that the decoder is in steady-state, short enough to not
  // bloat the run.
  preSwapSeconds: 1,
  // How long the pre-warmed decoder holds its first frame before swap.
  // Models "rebuild finished, waiting for next loop boundary."
  hotHoldMs: 500,
  maxQueue: 8,
}

interface SwapPass {
  /** ms from triggerSwap() call to first frame of B available. */
  swapGapMs: number
  /** Frames decoded from A in the loop before swap. */
  aFramesBeforeSwap: number
  /** True if (in hot pass) the held VideoFrame was still usable. */
  frameAlive: boolean
}

/** Start a continuous decode loop on `input` for at least `seconds`,
 *  then resolve. Returns the count of frames decoded. */
async function runDecoderFor(input: ProbeInput, seconds: number): Promise<number> {
  let decoded = 0
  const decoder = new VideoDecoder({
    output(frame) {
      decoded++
      frame.close()
    },
    error() {},
  })
  decoder.configure(input.config)
  const deadline = performance.now() + seconds * 1000
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

/** Cold-swap pass: after running A for preSwapSeconds, at swap
 *  moment, configure B + decode first chunk → measure to first frame. */
async function coldSwap(a: ProbeInput, b: ProbeInput): Promise<SwapPass> {
  const aFrames = await runDecoderFor(a, params.preSwapSeconds)
  const swapStart = performance.now()
  const { promise: firstFrame, resolve: resolveFirstFrame } = Promise.withResolvers<VideoFrame>()
  const decoder = new VideoDecoder({
    output(frame) {
      resolveFirstFrame(frame)
    },
    error(error) {
      throw error
    },
  })
  decoder.configure(b.config)
  decoder.decode(b.chunks[0])
  const frame = await firstFrame
  const swapGapMs = performance.now() - swapStart
  const frameAlive = frame.codedWidth > 0
  frame.close()
  decoder.close()
  return { swapGapMs, aFramesBeforeSwap: aFrames, frameAlive }
}

/** Hot-swap pass: pre-warm B before the swap (configure + decode first
 *  chunk, hold the VideoFrame), wait hotHoldMs, then "swap" — the
 *  frame is already in hand, so swapGapMs should be ~0. */
async function hotSwap(a: ProbeInput, b: ProbeInput): Promise<SwapPass> {
  // Start a SHORT A run; we'll concurrently pre-warm B.
  const aPromise = runDecoderFor(a, params.preSwapSeconds)
  // Pre-warm B's decoder and hold the first frame.
  const { promise: firstFrame, resolve: resolveFirstFrame } = Promise.withResolvers<VideoFrame>()
  const decoder = new VideoDecoder({
    output(frame) {
      resolveFirstFrame(frame)
    },
    error(error) {
      throw error
    },
  })
  decoder.configure(b.config)
  decoder.decode(b.chunks[0])
  const heldFrame = await firstFrame
  // Wait for A's run to finish + the hold time, simulating "decoder
  // pre-warmed, waiting for loop boundary".
  const aFrames = await aPromise
  await wait(params.hotHoldMs)
  // SWAP: at this instant the held frame is the cell's new content.
  const swapStart = performance.now()
  const frameAlive = heldFrame.codedWidth > 0
  // In production, the renderer would now upload heldFrame as the new
  // texture. We just measure the access cost.
  const swapGapMs = performance.now() - swapStart
  heldFrame.close()
  decoder.close()
  return { swapGapMs, aFramesBeforeSwap: aFrames, frameAlive }
}

async function run(): Promise<void> {
  status(`recording source clip (${params.recordSeconds}s)...`)
  const source = await recordProbeInput(
    params.captureResolution.width,
    params.captureResolution.height,
    params.recordSeconds,
  )
  status(`  got ${source.width}x${source.height}, ${source.chunks.length} chunks`)

  status(`baking atlas A...`)
  const aBake = await composite(source, 4, 4, params.atlasResolution.width, params.atlasResolution.height)
  status(`  A ${aBake.output.width}x${aBake.output.height} built in ${aBake.compositeMs.toFixed(0)}ms`)

  status(`baking atlas B...`)
  const bBake = await composite(source, 4, 4, params.atlasResolution.width, params.atlasResolution.height)
  status(`  B ${bBake.output.width}x${bBake.output.height} built in ${bBake.compositeMs.toFixed(0)}ms`)

  status(`COLD swap pass — configure + decode at swap moment...`)
  const cold = await coldSwap(aBake.output, bBake.output)
  status(
    `  cold: swapGap=${cold.swapGapMs.toFixed(2)}ms, aFramesBeforeSwap=${cold.aFramesBeforeSwap}, frameAlive=${cold.frameAlive}`,
  )

  status(`HOT swap pass — pre-warmed decoder holds first frame for ${params.hotHoldMs}ms...`)
  const hot = await hotSwap(aBake.output, bBake.output)
  status(
    `  hot: swapGap=${hot.swapGapMs.toFixed(2)}ms, aFramesBeforeSwap=${hot.aFramesBeforeSwap}, frameAlive=${hot.frameAlive}`,
  )

  status("done.")
  reportResult("atlas-swap", params, { cold, hot })
}

run().catch((error: unknown) => {
  status(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  reportResult("atlas-swap", params, {
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  })
})
