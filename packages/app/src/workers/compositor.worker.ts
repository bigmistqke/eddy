import { expose, type Transferred } from '@bigmistqke/rpc/messenger'
import { createCompositorEngine, type CompositorEngine } from '@eddy/compositor'
import { debug } from '@eddy/utils'
import { getActivePlacements } from '~/lib/timeline-compiler'
import type { LayoutTimeline } from '~/lib/layout-types'
import { PREVIEW_CLIP_ID } from '~/lib/layout-types'

const log = debug('compositor-worker', false)

/** Stats returned from render() for dropped frame tracking */
export interface RenderStats {
  /** Number of placements that should have rendered */
  expected: number
  /** Number of placements that actually had frames */
  rendered: number
  /** Number of placements that were missing frames (dropped) */
  dropped: number
  /** Number of placements that rendered a stale/repeated frame */
  stale: number
}

export interface CompositorWorkerMethods {
  /** Initialize with OffscreenCanvas */
  init(canvas: OffscreenCanvas, width: number, height: number): Promise<void>

  /** Set the compiled layout timeline */
  setTimeline(timeline: LayoutTimeline): void

  /** Set a preview stream for a track (continuously reads latest frame) */
  setPreviewStream(trackId: string, stream: ReadableStream<VideoFrame> | null): void

  /** Set a playback frame for a clip (for time-synced playback) */
  setFrame(clipId: string, frame: Transferred<VideoFrame> | null): void

  /** Connect a playback worker via MessagePort (for direct worker-to-worker frame transfer) */
  connectPlaybackWorker(clipId: string, port: MessagePort): void

  /** Disconnect a playback worker */
  disconnectPlaybackWorker(clipId: string): void

  /** Render at time T (queries timeline internally). Returns frame availability stats. */
  render(time: number): RenderStats

  /** Set a frame on capture canvas (for pre-rendering, doesn't affect visible canvas) */
  setCaptureFrame(clipId: string, frame: Transferred<VideoFrame> | null): void

  /** Render to capture canvas at time T */
  renderToCaptureCanvas(time: number): void

  /** Capture frame from capture canvas as VideoFrame */
  captureFrame(timestamp: number): VideoFrame | null

  /** Clean up resources */
  destroy(): void
}

/**********************************************************************************/
/*                                                                                */
/*                                     State                                      */
/*                                                                                */
/**********************************************************************************/

// Compositor engines
let mainEngine: CompositorEngine | null = null
let captureEngine: CompositorEngine | null = null

// Current layout timeline
let timeline: LayoutTimeline | null = null

// Frame sources - keyed by clipId
const playbackFrames = new Map<string, VideoFrame>()

// Preview frames - keyed by trackId (for camera preview during recording)
const previewFrames = new Map<string, VideoFrame>()
const previewReaders = new Map<string, ReadableStreamDefaultReader<VideoFrame>>()

// Playback worker connections - keyed by clipId
const playbackWorkerPorts = new Map<string, MessagePort>()

// Track last rendered frame info per clipId for stale detection
// A frame is only stale if enough time passed for a new frame to be expected
interface LastFrameInfo {
  timestamp: number // VideoFrame.timestamp (microseconds)
  duration: number // VideoFrame.duration (microseconds)
}
const lastRenderedFrame = new Map<string, LastFrameInfo>()

/**********************************************************************************/
/*                                                                                */
/*                                   Helpers                                      */
/*                                                                                */
/**********************************************************************************/

function setFrame(clipId: string, frame: VideoFrame | null) {
  // Close previous playback frame
  const prevFrame = playbackFrames.get(clipId)
  if (prevFrame) {
    prevFrame.close()
  }

  if (frame) {
    playbackFrames.set(clipId, frame)
  } else {
    playbackFrames.delete(clipId)
  }
}

async function readPreviewStream(trackId: string, stream: ReadableStream<VideoFrame>) {
  log('readPreviewStream: starting', { trackId })
  const reader = stream.getReader()
  previewReaders.set(trackId, reader)

  try {
    while (true) {
      const { done, value: frame } = await reader.read()
      if (done) {
        log('readPreviewStream: stream done', { trackId })
        break
      }

      // Close previous frame and store new one
      const prevFrame = previewFrames.get(trackId)
      if (prevFrame) {
        prevFrame.close()
      }
      previewFrames.set(trackId, frame)
    }
  } catch (error) {
    log('readPreviewStream: error', { trackId, error })
  }

  previewReaders.delete(trackId)
  log('readPreviewStream: ended', { trackId })
}

/**********************************************************************************/
/*                                                                                */
/*                                    Methods                                     */
/*                                                                                */
/**********************************************************************************/

expose<CompositorWorkerMethods>({
  setFrame,

  async init(offscreenCanvas, width, height) {
    log('init', { width, height })

    // Main canvas (visible)
    mainEngine = createCompositorEngine(offscreenCanvas)

    // Capture canvas (for pre-rendering, same size)
    const captureCanvas = new OffscreenCanvas(width, height)
    captureEngine = createCompositorEngine(captureCanvas)
  },

  setTimeline(newTimeline) {
    timeline = newTimeline
    log('setTimeline', { duration: timeline.duration, segments: timeline.segments.length })
  },

  setPreviewStream(trackId, stream) {
    log('setPreviewStream', { trackId, hasStream: !!stream })

    // Cancel existing reader
    const existingReader = previewReaders.get(trackId)
    if (existingReader) {
      existingReader.cancel()
      previewReaders.delete(trackId)
    }

    // Close existing preview frame
    const existingFrame = previewFrames.get(trackId)
    if (existingFrame) {
      existingFrame.close()
      previewFrames.delete(trackId)
    }

    // Start reading new stream
    if (stream) {
      readPreviewStream(trackId, stream)
    }
  },

  connectPlaybackWorker(clipId, port) {
    log('connectPlaybackWorker', { clipId })

    // Disconnect existing port for this clip
    const existingPort = playbackWorkerPorts.get(clipId)
    if (existingPort) {
      existingPort.close()
    }

    // Store the port
    playbackWorkerPorts.set(clipId, port)

    // Expose setFrame method on this port for playback worker to call
    expose(
      {
        setFrame,
      },
      { to: port },
    )
  },

  disconnectPlaybackWorker(clipId) {
    log('disconnectPlaybackWorker', { clipId })

    const port = playbackWorkerPorts.get(clipId)
    if (port) {
      port.close()
      playbackWorkerPorts.delete(clipId)
    }

    // Close any remaining frame for this clip
    const frame = playbackFrames.get(clipId)
    if (frame) {
      frame.close()
      playbackFrames.delete(clipId)
    }
  },

  render(time): RenderStats {
    const stats: RenderStats = { expected: 0, rendered: 0, dropped: 0, stale: 0 }

    if (!mainEngine || !timeline) return stats

    // Clear canvas
    mainEngine.clear()

    // Query timeline for active placements at this time
    const activePlacements = getActivePlacements(timeline, time)
    stats.expected = activePlacements.length

    // Render all active placements
    for (const { placement } of activePlacements) {
      // Get frame from appropriate source based on clipId
      const isPreview = placement.clipId === PREVIEW_CLIP_ID
      const frame = isPreview
        ? previewFrames.get(placement.trackId)
        : playbackFrames.get(placement.clipId)

      if (!frame) {
        stats.dropped++
        continue
      }

      // Check for stale frame - only count as stale if a new frame SHOULD be available
      const frameKey = isPreview ? `preview-${placement.trackId}` : placement.clipId
      const lastInfo = lastRenderedFrame.get(frameKey)
      if (lastInfo && frame.timestamp === lastInfo.timestamp && lastInfo.duration > 0) {
        // Same frame as before - check if current render time exceeds frame's valid period
        const frameEndTime = (lastInfo.timestamp + lastInfo.duration) / 1_000_000
        if (time >= frameEndTime) {
          // Render time is past when next frame should be available - this is truly stale
          stats.stale++
        }
      }
      lastRenderedFrame.set(frameKey, {
        timestamp: frame.timestamp,
        duration: frame.duration ?? 0,
      })

      stats.rendered++

      // Use trackId for texture key when preview (avoids collision with playback textures)
      const textureKey = isPreview ? `preview-${placement.trackId}` : placement.clipId
      mainEngine.renderPlacement({
        id: textureKey,
        frame,
        viewport: placement.viewport,
      })
    }

    return stats
  },

  setCaptureFrame(clipId, frame) {
    if (!captureEngine || !frame) return

    captureEngine.uploadFrame(clipId, frame)
    frame.close()
  },

  renderToCaptureCanvas(time) {
    if (!captureEngine || !timeline) return

    // Query timeline for active placements
    const activePlacements = getActivePlacements(timeline, time)

    // Render using pre-uploaded textures
    captureEngine.renderById(
      activePlacements.map(({ placement }) => ({
        id: placement.clipId,
        viewport: placement.viewport,
      })),
    )
  },

  captureFrame(timestamp) {
    if (!captureEngine) return null
    return captureEngine.captureFrame(timestamp)
  },

  destroy() {
    log('destroy')

    // Close all frames
    for (const frame of playbackFrames.values()) {
      frame.close()
    }
    playbackFrames.clear()

    for (const frame of previewFrames.values()) {
      frame.close()
    }
    previewFrames.clear()

    // Cancel all preview readers
    for (const reader of previewReaders.values()) {
      reader.cancel()
    }
    previewReaders.clear()

    // Close all ports
    for (const port of playbackWorkerPorts.values()) {
      port.close()
    }
    playbackWorkerPorts.clear()

    // Destroy engines
    if (mainEngine) {
      mainEngine.destroy()
      mainEngine = null
    }
    if (captureEngine) {
      captureEngine.destroy()
      captureEngine = null
    }
  },
})
