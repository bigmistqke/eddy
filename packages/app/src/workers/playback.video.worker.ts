import { expose, rpc, transfer, type RPC } from '@bigmistqke/rpc/messenger'
import type { VideoTrackInfo } from '@eddy/media'
import { debug } from '@eddy/utils'
import { makeVideoPlayback, type VideoPlaybackState } from '@eddy/video'
import { makeOPFSSource } from '~/opfs'
import {
  makeScheduler,
  type PlaybackScheduler,
  type SchedulerBuffer,
} from '~/primitives/make-scheduler'

const log = debug('playback.video.worker', false)

/** Methods exposed by compositor worker (subset we need) */
interface CompositorFrameMethods {
  setFrame(clipId: string, frame: VideoFrame | null): void
}

export interface VideoPlaybackWorkerMethods {
  /** Set scheduler buffer for cross-worker coordination */
  setSchedulerBuffer(buffer: SchedulerBuffer): void

  /** Load a clip from OPFS for playback */
  load(clipId: string): Promise<{ duration: number; videoTrack: VideoTrackInfo | null }>

  /** Connect to compositor via MessagePort */
  connectToCompositor(id: string, port: MessagePort): void

  /** Start playback from time at speed */
  play(startTime: number, playbackSpeed?: number): void

  /** Pause playback */
  pause(): void

  /** Seek to time (buffers from keyframe) */
  seek(time: number): Promise<void>

  /** Get current buffer range */
  getBufferRange(): { start: number; end: number }

  /** Get current state */
  getState(): VideoPlaybackState

  /** Get performance stats */
  getPerf(): Record<
    string,
    { samples: number; avg: number; max: number; min: number; overThreshold: number }
  >

  /** Reset performance stats */
  resetPerf(): void

  /** Get frame at specific time (for export) */
  getFrameAtTime(time: number): Promise<VideoFrame | null>
}

/**********************************************************************************/
/*                                                                                */
/*                                     State                                      */
/*                                                                                */
/**********************************************************************************/

// Unique worker ID for debugging
const workerId = Math.random().toString(36).substring(2, 8)
log('Worker created with ID:', workerId)

const playback = makeVideoPlayback({
  onFrame(frame) {
    if (compositor && clipId) {
      if (frame) {
        compositor.setFrame(clipId, transfer(frame))
      } else {
        compositor.setFrame(clipId, null)
      }
    }
  },
  shouldSkipDeltaFrame() {
    if (!scheduler) {
      return false
    }
    return scheduler.shouldSkipDeltaFrames()
  },
})

// Compositor connection
let compositor: RPC<CompositorFrameMethods> | null = null
let clipId = ''

// Scheduler for cross-worker coordination
let scheduler: PlaybackScheduler | null = null

/**********************************************************************************/
/*                                                                                */
/*                                     Methods                                    */
/*                                                                                */
/**********************************************************************************/

expose<VideoPlaybackWorkerMethods>({
  getBufferRange: playback.getBufferRange,
  getPerf: playback.getPerf,
  getState: playback.getState,
  pause: playback.pause,
  play: playback.play,
  resetPerf: playback.resetPerf,
  seek: playback.seek,

  setSchedulerBuffer(buffer) {
    log('setSchedulerBuffer')

    scheduler = makeScheduler(buffer).playback
  },

  async load(clipId) {
    log('load', { clipId })

    // Create OPFS source and load
    const source = await makeOPFSSource(clipId)
    return playback.load(source)
  },

  connectToCompositor(id, port) {
    log('connectToCompositor', { clipId: id })

    clipId = id
    compositor = rpc<CompositorFrameMethods>(port)

    // Immediately send buffered frame if available (for gapless handoff)
    playback.sendCurrentFrame()
  },

  async getFrameAtTime(time) {
    const frame = await playback.getFrameAtTime(time)
    return frame ? transfer(frame) : null
  },
})
