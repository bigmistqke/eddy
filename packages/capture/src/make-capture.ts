/**
 * Make Capture
 *
 * Factory function that creates a capture pipeline for recording video/audio streams.
 * Abstracts away worker setup and communication - just pass ReadableStreams.
 */

import { $MESSENGER, rpc, transfer } from '@bigmistqke/rpc/messenger'
import type { MuxerOptions } from '@eddy/media'
import { debug } from '@eddy/utils'

import type { CaptureWorkerMethods } from './workers/capture.worker'
import CaptureWorker from './workers/capture.worker?worker'
import type { MuxerWorkerMethods } from './workers/muxer.worker'
import MuxerWorker from './workers/muxer.worker?worker'

const log = debug('capture', false)

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

export interface CaptureConfig {
  /** Video codec (default: 'vp9') */
  videoCodec?: MuxerOptions['videoCodec']
  /** Video bitrate in bits/second (default: 2_000_000) */
  videoBitrate?: number
  /** Audio codec (default: 'opus') */
  audioCodec?: MuxerOptions['audioCodec']
  /** Audio bitrate in bits/second (default: 128_000) */
  audioBitrate?: number
  /** Whether to include audio (default: true) */
  audio?: boolean
  /** Optional scheduler buffer for backpressure coordination with playback */
  schedulerBuffer?: SharedArrayBuffer
}

export interface Capture {
  /**
   * Start capturing from video and audio streams.
   * Streams are transferred to workers - do not reuse after calling this.
   */
  start(
    videoStream: ReadableStream<VideoFrame>,
    audioStream?: ReadableStream<AudioData>,
  ): Promise<void>

  /** Stop capturing (cancels stream readers) */
  stop(): Promise<void>

  /**
   * Finalize recording and write to OPFS.
   * @param clipId - Unique identifier for the clip (used as OPFS filename)
   * @returns The clipId and frame count
   */
  finalize(clipId: string): Promise<{ clipId: string; frameCount: number }>

  /** Reset for next recording (re-initializes encoders) */
  reset(): Promise<void>

  /** Dispose workers and clean up */
  dispose(): void
}

/**********************************************************************************/
/*                                                                                */
/*                                  Make Capture                                  */
/*                                                                                */
/**********************************************************************************/

/**
 * Create a capture pipeline for recording video/audio streams to OPFS.
 *
 * @example
 * ```ts
 * const capture = await makeCapture({ videoCodec: 'vp9' })
 *
 * // Start capturing from any ReadableStream<VideoFrame>
 * await capture.start(videoStream, audioStream)
 *
 * // ... recording happens ...
 *
 * // Stop and finalize
 * await capture.stop()
 * const { clipId, frameCount } = await capture.finalize('my-clip-123')
 *
 * // Reset for next recording
 * await capture.reset()
 *
 * // Clean up when done
 * capture.dispose()
 * ```
 */
export async function makeCapture(config: CaptureConfig = {}): Promise<Capture> {
  const {
    videoCodec = 'vp9',
    videoBitrate = 2_000_000,
    audioCodec = 'opus',
    audioBitrate = 128_000,
    audio = true,
    schedulerBuffer,
  } = config

  log('creating capture pipeline', { videoCodec, audio })

  // Create workers
  const captureWorker = new CaptureWorker()
  const muxerWorker = new MuxerWorker()

  const captureWorkerRpc = rpc<CaptureWorkerMethods>(captureWorker)
  const muxerWorkerRpc = rpc<MuxerWorkerMethods>(muxerWorker)

  // Pass scheduler buffer to muxer for backpressure signaling (if provided)
  if (schedulerBuffer) {
    muxerWorkerRpc.setSchedulerBuffer(schedulerBuffer)
  }

  // Create MessageChannel to connect capture → muxer
  const channel = new MessageChannel()

  // Set up capture port on muxer
  await muxerWorkerRpc.setCapturePort(transfer(channel.port2))

  // Initialize capture with muxer port
  const captureRpc = await captureWorkerRpc.init(transfer(channel.port1))

  // Initialize muxer with codec settings
  const muxerRpc = await muxerWorkerRpc.init({
    videoCodec,
    videoBitrate,
    audioCodec,
    audioBitrate,
    audio,
  })

  log('capture pipeline ready')

  return {
    async start(videoStream, audioStream) {
      log('starting capture')
      await captureRpc.start(transfer(videoStream), audioStream ? transfer(audioStream) : undefined)
    },

    async stop() {
      log('stopping capture')
      await captureRpc.stop()
    },

    async finalize(clipId) {
      log('finalizing', { clipId })
      return muxerRpc.finalize(clipId)
    },

    async reset() {
      log('resetting')
      await muxerRpc.reset()
    },

    dispose() {
      log('disposing')
      captureWorkerRpc[$MESSENGER].terminate()
      muxerWorkerRpc[$MESSENGER].terminate()
    },
  }
}
