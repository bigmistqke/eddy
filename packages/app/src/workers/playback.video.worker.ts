/**
 * Video Playback Worker
 *
 * Thin RPC wrapper around makeVideoPlayback. Handles worker-specific concerns:
 * - RPC exposure via @bigmistqke/rpc/messenger
 * - Worker-to-worker MessagePort connections for frame transfer to compositor
 */

import { expose, rpc, transfer, type RPC } from '@bigmistqke/rpc/messenger'
import type { VideoTrackInfo } from '@eddy/media'
import { debug, pick } from '@eddy/utils'
import { makeVideoPlayback, type VideoPlayback } from '@eddy/video'
import { makeOPFSSource } from '~/opfs'
import {
  makeScheduler,
  type PlaybackScheduler,
  type SchedulerBuffer,
} from '~/primitives/make-scheduler'

const log = debug('playback.video.worker', false)

// Unique worker ID for debugging
const workerId = Math.random().toString(36).substring(2, 8)
log('Worker created with ID:', workerId)

/** Methods exposed by compositor worker (subset we need) */
interface CompositorFrameMethods {
  setFrame(clipId: string, frame: VideoFrame | null): void
}

export interface VideoPlaybackWorkerMethods extends Pick<
  VideoPlayback,
  'getBufferRange' | 'getPerf' | 'getState' | 'pause' | 'play' | 'resetPerf' | 'seek'
> {
  /** Set scheduler buffer for cross-worker coordination */
  setSchedulerBuffer(buffer: SchedulerBuffer): void

  /** Load a clip from OPFS for playback */
  load(clipId: string): Promise<{ duration: number; videoTrack: VideoTrackInfo | null }>

  /** Connect to compositor via MessagePort */
  connectToCompositor(id: string, port: MessagePort): void

  /** Get frame at specific time (for export) */
  getFrameAtTime(time: number): Promise<VideoFrame | null>
}

/**********************************************************************************/
/*                                                                                */
/*                                     State                                      */
/*                                                                                */
/**********************************************************************************/

// Compositor connection
let compositor: RPC<CompositorFrameMethods> | null = null
let clipId = ''

// Scheduler for cross-worker coordination
let scheduler: PlaybackScheduler | null = null

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

/**********************************************************************************/
/*                                                                                */
/*                                    Expose                                      */
/*                                                                                */
/**********************************************************************************/

expose<VideoPlaybackWorkerMethods>({
  ...pick(playback, [
    'getBufferRange',
    'getPerf',
    'getState',
    'pause',
    'play',
    'resetPerf',
    'seek',
  ]),

  setSchedulerBuffer(buffer) {
    log('setSchedulerBuffer')
    scheduler = makeScheduler(buffer).playback
  },

  async load(id) {
    log('load', { clipId: id })
    const source = await makeOPFSSource(id)
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
