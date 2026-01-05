/**
 * Debug Capture Worker
 *
 * Reads VideoFrames from camera stream, copies to ArrayBuffer, transfers to muxer.
 *
 * Communication:
 * - Main thread: RPC via @bigmistqke/rpc (setMuxerPort, start, stop)
 * - Muxer worker: RPC via @bigmistqke/rpc on transferred MessagePort
 *
 * This worker's job is to capture frames as fast as possible and release
 * VideoFrame hardware resources immediately. It does NOT wait for muxer - just queues everything.
 */

import { expose, rpc } from '@bigmistqke/rpc/messenger'
import type { CaptureWorkerMethods, MuxerFrameData, MuxerInitConfig } from './debug-types'

/** Methods exposed by muxer on the capture port */
interface MuxerPortMethods {
  init(config: MuxerInitConfig): void
  addFrame(data: MuxerFrameData): void
  captureEnded(frameCount: number): void
}

let capturing = false
let reader: ReadableStreamDefaultReader<VideoFrame> | null = null
let muxer: ReturnType<typeof rpc<MuxerPortMethods>> | null = null

async function copyFrameToBuffer(frame: VideoFrame): Promise<{
  buffer: ArrayBuffer
  format: VideoPixelFormat
  codedWidth: number
  codedHeight: number
}> {
  const format = frame.format!
  const codedWidth = frame.codedWidth
  const codedHeight = frame.codedHeight
  const buffer = new ArrayBuffer(frame.allocationSize())
  await frame.copyTo(buffer)
  frame.close()
  return { buffer, format, codedWidth, codedHeight }
}

const methods: CaptureWorkerMethods = {
  setMuxerPort(port: MessagePort) {
    port.start()
    muxer = rpc<MuxerPortMethods>(port)
    console.log('[debug-capture] received muxer port, created RPC proxy')
  },

  async start(readable: ReadableStream<VideoFrame>) {
    if (!muxer) {
      throw new Error('No muxer - call setMuxerPort first')
    }

    console.log('[debug-capture] start received, beginning capture')

    capturing = true

    reader = readable.getReader()

    let firstTimestamp: number | null = null
    let frameCount = 0

    try {
      // Read first frame
      const { done: done1, value: frame1 } = await reader.read()
      if (done1 || !frame1) {
        throw new Error('No frames available')
      }

      // Read second frame to check for staleness
      const { done: done2, value: frame2 } = await reader.read()
      if (done2 || !frame2) {
        // Only got one frame, use it
        firstTimestamp = frame1.timestamp
        const data = await copyFrameToBuffer(frame1)
        muxer.init({ format: data.format, codedWidth: data.codedWidth, codedHeight: data.codedHeight })
        muxer.addFrame({ ...data, timestampSec: 0 })
        frameCount++
        console.log('[debug-capture] capturing frames')
      } else {
        // Check gap between frame1 and frame2
        const gap = (frame2.timestamp - frame1.timestamp) / 1_000_000

        if (gap > 0.5) {
          // Frame1 is stale - discard it, use frame2 as first
          console.log(`[debug-capture] discarding stale frame, gap=${gap.toFixed(3)}s`)
          frame1.close()
          firstTimestamp = frame2.timestamp
          const data = await copyFrameToBuffer(frame2)
          muxer.init({ format: data.format, codedWidth: data.codedWidth, codedHeight: data.codedHeight })
          muxer.addFrame({ ...data, timestampSec: 0 })
          frameCount++
        } else {
          // Frame1 is valid - use it as first, then process frame2
          firstTimestamp = frame1.timestamp
          const data1 = await copyFrameToBuffer(frame1)
          muxer.init({ format: data1.format, codedWidth: data1.codedWidth, codedHeight: data1.codedHeight })
          muxer.addFrame({ ...data1, timestampSec: 0 })
          frameCount++

          const timestampSec2 = (frame2.timestamp - firstTimestamp) / 1_000_000
          const data2 = await copyFrameToBuffer(frame2)
          muxer.addFrame({ ...data2, timestampSec: timestampSec2 })
          frameCount++
        }
        console.log(`[debug-capture] first frame ts=${(firstTimestamp/1_000_000).toFixed(3)}s, capturing...`)
      }

      // Continue with remaining frames
      while (capturing) {
        const { done, value: frame } = await reader.read()
        if (done || !frame) break

        const timestampSec = (frame.timestamp - firstTimestamp) / 1_000_000
        const data = await copyFrameToBuffer(frame)
        muxer.addFrame({ ...data, timestampSec })
        frameCount++
      }
    } catch (err) {
      console.error('[debug-capture] error:', err)
      throw err
    }

    // Signal end of stream
    muxer.captureEnded(frameCount)
    console.log(`[debug-capture] done, ${frameCount} frames captured`)
  },

  stop() {
    capturing = false
    reader?.cancel().catch(() => {})
    console.log('[debug-capture] stop received')
  },
}

expose(methods)
