import { expose, rpc, transfer, type RPC } from '@bigmistqke/rpc/messenger'
import type { VideoTrackInfo } from '@eddy/codecs'
import { createPlaybackEngine, type PlaybackEngine, type PlaybackState } from '@eddy/playback'
import { debug } from '@eddy/utils'

const log = debug('playback-worker', false)

/** Methods exposed by compositor worker (subset we need) */
interface CompositorFrameMethods {
  setFrame(clipId: string, frame: VideoFrame | null): void
}

export interface PlaybackWorkerMethods {
  /** Load a blob for playback */
  load(buffer: ArrayBuffer): Promise<{ duration: number; videoTrack: VideoTrackInfo | null }>

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
  getState(): PlaybackState

  /** Get performance stats */
  getPerf(): Record<string, { samples: number; avg: number; max: number; min: number; overThreshold: number }>

  /** Reset performance stats */
  resetPerf(): void

  /** Clean up resources */
  destroy(): void
}

/**********************************************************************************/
/*                                                                                */
/*                                     State                                      */
/*                                                                                */
/**********************************************************************************/

// Unique worker ID for debugging
const workerId = Math.random().toString(36).substring(2, 8)
log('Worker created with ID:', workerId)

// Compositor connection
let compositor: RPC<CompositorFrameMethods> | null = null
let clipId = ''

// Playback engine
let engine: PlaybackEngine | null = null

/**********************************************************************************/
/*                                                                                */
/*                                     Methods                                    */
/*                                                                                */
/**********************************************************************************/

expose<PlaybackWorkerMethods>({
  async load(buffer) {
    log('load', { size: buffer.byteLength })

    // Clean up previous engine
    if (engine) {
      engine.destroy()
    }

    // Create new engine with frame callback
    engine = createPlaybackEngine({
      onFrame: frame => {
        if (compositor && clipId) {
          if (frame) {
            compositor.setFrame(clipId, transfer(frame))
          } else {
            compositor.setFrame(clipId, null)
          }
        }
      },
    })

    return engine.load(buffer)
  },

  connectToCompositor(id, port) {
    log('connectToCompositor', { clipId: id })
    clipId = id
    compositor = rpc<CompositorFrameMethods>(port)

    // Immediately send buffered frame if available (for gapless handoff)
    if (engine) {
      engine.sendCurrentFrame()
    }
  },

  play(startTime, playbackSpeed = 1) {
    log('play', { startTime, playbackSpeed })
    if (!engine) {
      log('play: no engine')
      return
    }
    engine.play(startTime, playbackSpeed)
  },

  pause() {
    log('pause RPC received', { workerId, clipId })
    if (!engine) {
      log('pause: no engine')
      return
    }
    engine.pause()
  },

  async seek(time) {
    log('seek RPC received', { workerId, time, clipId })
    if (!engine) {
      log('seek: no engine')
      return
    }
    await engine.seek(time)
  },

  getBufferRange() {
    if (!engine) {
      return { start: 0, end: 0 }
    }
    return engine.getBufferRange()
  },

  getState() {
    if (!engine) {
      return 'idle'
    }
    return engine.state
  },

  getPerf() {
    if (!engine) {
      return {}
    }
    return engine.getPerf()
  },

  resetPerf() {
    if (engine) {
      engine.resetPerf()
    }
  },

  destroy() {
    log('destroy RPC received', { workerId, clipId })
    if (engine) {
      engine.destroy()
      engine = null
    }
    compositor = null
    clipId = ''
  },
})
