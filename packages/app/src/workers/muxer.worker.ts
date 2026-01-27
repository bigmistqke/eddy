/**
 * Muxer Worker
 *
 * Thin RPC wrapper around makeMuxer. Handles encoding and muxing of video/audio frames.
 * - RPC exposure via @bigmistqke/rpc/messenger
 * - Worker-to-worker MessagePort connections for receiving frames from capture worker
 */

import { expose, handle, type Handled } from '@bigmistqke/rpc/messenger'
import { makeMuxer, type AudioFrameData, type VideoFrameData } from '@eddy/media'
import { debug } from '@eddy/utils'
import { writeBlob } from '~/opfs'
import {
  makeScheduler,
  type RecorderScheduler,
  type SchedulerBuffer,
} from '~/primitives/make-scheduler'

const log = debug('muxer.worker', false)

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

/** Methods returned by init() as a sub-proxy */
export interface MuxerMethods {
  /** Add a video frame to be encoded */
  addVideoFrame(data: VideoFrameData): void

  /** Add audio samples to be encoded */
  addAudioFrame(data: AudioFrameData): void

  /**
   * Signal end of stream and finalize the output.
   * Writes the encoded WebM to OPFS and returns the clipId.
   */
  finalize(clipId: string): Promise<{ clipId: string; frameCount: number }>

  /** Reset state for next recording (re-initializes encoders) */
  reset(): Promise<void>
}

export interface MuxerWorkerMethods {
  /**
   * Set scheduler buffer for cross-worker coordination.
   * Call this before recording.
   */
  setSchedulerBuffer(buffer: SharedArrayBuffer): void

  /**
   * Set the capture port for receiving frames from capture worker.
   * Call this before recording.
   */
  setCapturePort(port: MessagePort): void

  /**
   * Initialize the muxer (creates VP9 encoder + Opus encoder).
   * Returns methods as sub-proxy.
   */
  init(): Promise<Handled<MuxerMethods>>
}

/**********************************************************************************/
/*                                                                                */
/*                                     State                                      */
/*                                                                                */
/**********************************************************************************/

let scheduler: RecorderScheduler | null = null

// Capture port methods reference (needs to be updated when muxer is created)
let capturePortMethods: {
  addVideoFrame: (data: VideoFrameData) => void
  addAudioFrame: (data: AudioFrameData) => void
  captureEnded: (frameCount: number) => void
} | null = null

/**********************************************************************************/
/*                                                                                */
/*                                    Expose                                      */
/*                                                                                */
/**********************************************************************************/

expose<MuxerWorkerMethods>({
  setSchedulerBuffer(buffer) {
    log('setSchedulerBuffer')
    scheduler = makeScheduler(buffer as SchedulerBuffer).recorder
  },

  setCapturePort(port) {
    log('received capture port')

    // Create placeholder methods that will be updated when init() is called
    capturePortMethods = {
      addVideoFrame: () => log('not initialized, dropping video frame'),
      addAudioFrame: () => log('not initialized, dropping audio frame'),
      captureEnded: () => {},
    }

    // Expose methods on this port for capture worker to call
    expose(
      {
        addVideoFrame: (data: VideoFrameData) => capturePortMethods?.addVideoFrame(data),
        addAudioFrame: (data: AudioFrameData) => capturePortMethods?.addAudioFrame(data),
        captureEnded: (frameCount: number) => capturePortMethods?.captureEnded(frameCount),
      },
      { to: port },
    )
  },

  async init() {
    log('initializing VP9 + Opus encoders...')

    const muxer = makeMuxer({ videoCodec: 'vp9', videoBitrate: 2_000_000, audio: true })
    await muxer.init()

    let capturedFrameCount = 0

    // Update capture port methods to use this muxer
    if (capturePortMethods) {
      capturePortMethods.addVideoFrame = (data: VideoFrameData) => {
        muxer.addVideoFrame(data)
        if (scheduler) {
          scheduler.updateFromEncoder(muxer.videoQueueSize)
        }
      }
      capturePortMethods.addAudioFrame = (data: AudioFrameData) => {
        muxer.addAudioFrame(data)
      }
      capturePortMethods.captureEnded = (frameCount: number) => {
        capturedFrameCount = frameCount
        log('capture ended', { frameCount })
      }
    }

    log('initialization complete')

    return handle({
      addAudioFrame: muxer.addAudioFrame,

      addVideoFrame(data) {
        muxer.addVideoFrame(data)
        if (scheduler) {
          scheduler.updateFromEncoder(muxer.videoQueueSize)
        }
      },

      async finalize(clipId) {
        log('finalizing', { clipId, captured: capturedFrameCount })

        const result = await muxer.finalize()

        log('finalized', { clipId, frames: result.videoFrameCount, bytes: result.blob.size })

        // Write to OPFS
        await writeBlob(clipId, result.blob)

        log('written to OPFS', { clipId })

        return { clipId, frameCount: result.videoFrameCount }
      },

      async reset() {
        capturedFrameCount = 0
        muxer.reset()
        await muxer.init() // Re-initialize after reset
        scheduler?.reset()
      },
    } satisfies MuxerMethods)
  },
})
