import { expose } from '@bigmistqke/rpc/messenger'
import { makeMuxer, type AudioFrameData, type Muxer, type VideoFrameData } from '@eddy/media'
import { debug } from '@eddy/utils'
import { writeBlob } from '~/opfs'
import {
  makeScheduler,
  type RecorderScheduler,
  type SchedulerBuffer,
} from '~/primitives/make-scheduler'

const log = debug('muxer.worker', false)

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
   * Pre-initialize the muxer (creates VP9 encoder + Opus encoder).
   * Call this before recording to avoid startup delay.
   */
  preInit(): Promise<void>

  /**
   * Add a video frame to be encoded.
   */
  addVideoFrame(data: VideoFrameData): void

  /**
   * Add audio samples to be encoded.
   */
  addAudioFrame(data: AudioFrameData): void

  /**
   * Signal end of stream and finalize the output.
   * Writes the encoded WebM to OPFS and returns the clipId.
   */
  finalize(clipId: string): Promise<{ clipId: string; frameCount: number }>

  /** Reset state for next recording */
  reset(): void
}

/**********************************************************************************/
/*                                                                                */
/*                                     Methods                                    */
/*                                                                                */
/**********************************************************************************/

// Worker state
let muxer: Muxer | null = null
let capturedFrameCount = 0
let scheduler: RecorderScheduler | null = null

function addVideoFrame(data: VideoFrameData) {
  if (!muxer) {
    log('not initialized, dropping video frame')
    return
  }
  muxer.addVideoFrame(data)

  // Update scheduler with queue depth for backpressure signaling
  if (scheduler) {
    scheduler.updateFromEncoder(muxer.videoQueueSize)
  }
}

function addAudioFrame(data: AudioFrameData) {
  if (!muxer) {
    log('not initialized, dropping audio frame')
    return
  }
  muxer.addAudioFrame(data)
}

expose<MuxerWorkerMethods>({
  setSchedulerBuffer(buffer) {
    log('setSchedulerBuffer')
    scheduler = makeScheduler(buffer as SchedulerBuffer).recorder
  },

  addVideoFrame,
  addAudioFrame,

  setCapturePort(port) {
    log('received capture port')
    // Expose methods on this port for capture worker to call
    expose(
      {
        addVideoFrame,
        addAudioFrame,
        captureEnded: (frameCount: number) => {
          capturedFrameCount = frameCount
          log('capture ended', { frameCount: capturedFrameCount })
        },
      },
      { to: port },
    )
  },

  async preInit() {
    if (muxer?.isReady) return

    log('pre-initializing VP9 + Opus encoders...')

    muxer = makeMuxer({ videoCodec: 'vp9', videoBitrate: 2_000_000, audio: true })
    await muxer.init()

    log('pre-initialization complete')
  },

  async finalize(clipId) {
    log('finalizing', { clipId, captured: capturedFrameCount })

    if (!muxer) {
      return { clipId, frameCount: 0 }
    }

    const result = await muxer.finalize()

    log('finalized', { clipId, frames: result.videoFrameCount, bytes: result.blob.size })

    // Write to OPFS
    await writeBlob(clipId, result.blob)

    log('written to OPFS', { clipId })

    return { clipId, frameCount: result.videoFrameCount }
  },

  reset() {
    capturedFrameCount = 0
    muxer?.reset()
    muxer = null

    // Reset scheduler to idle (recording stopped)
    scheduler?.reset()
  },
})
