import { expose, type Transferred } from '@bigmistqke/rpc/messenger'
import { debug } from '@eddy/utils'
import {
  createVideoEffect,
  makeVideoCompositor,
  registerBuiltInVideoEffects,
  type CompiledEffectChain,
  type VideoCompositor,
  type VideoEffectToken,
} from '@eddy/video'
import {
  getActivePlacements,
  PREVIEW_CLIP_ID,
  type CompiledTimeline,
  type Placement,
} from '~/primitives/compile-layout-timeline'

// Register built-in video effects
registerBuiltInVideoEffects()

const log = debug('compositor.worker', false)

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

/** Video effect from pipeline (simplified for worker transport) */
interface VideoPipelineEffect {
  type: string
  value?: { value: number }
}

export interface CompositorWorkerMethods {
  /** Initialize with OffscreenCanvas */
  init(canvas: OffscreenCanvas, width: number, height: number): Promise<void>

  /** Set the compiled layout timeline */
  setTimeline(timeline: CompiledTimeline): void

  /** Set video effect pipeline for a track */
  setTrackVideoPipeline(trackId: string, pipeline: VideoPipelineEffect[]): void

  /** Update a single video effect value for a track */
  setTrackVideoEffectValue(trackId: string, effectIndex: number, value: number): void

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

  /** Render to capture canvas at time T */
  renderToCaptureCanvas(time: number): void

  /** Render and capture a frame for export (returns VideoFrame) */
  renderAndCapture(time: number): VideoFrame | null

  /** Render with provided frames and capture (for export) */
  renderFramesAndCapture(
    time: number,
    frameEntries: Array<{ clipId: string; frame: VideoFrame }>,
  ): VideoFrame | null

  /** Clean up resources */
  destroy(): void
}

/**********************************************************************************/
/*                                                                                */
/*                                     State                                      */
/*                                                                                */
/**********************************************************************************/

// Compositor engines
let mainEngine: VideoCompositor | null = null
let captureEngine: VideoCompositor | null = null

// Current compiled timeline
let compiledTimeline: CompiledTimeline | null = null

// Frame sources - keyed by clipId
const frames = new Map<string, VideoFrame>()

// Preview frames - keyed by trackId (for camera preview during recording)
let previewFrame: VideoFrame | null = null
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

// Track video effect chains per trackId
// Stores the pipeline definition and compiled chain
interface TrackVideoEffects {
  pipeline: VideoPipelineEffect[]
  compiled: CompiledEffectChain | null
}
const trackVideoEffects = new Map<string, TrackVideoEffects>()

let renderStats: RenderStats = { expected: 0, rendered: 0, dropped: 0, stale: 0 }

/**********************************************************************************/
/*                                                                                */
/*                                    Utils                                       */
/*                                                                                */
/**********************************************************************************/

function setFrame(clipId: string, frame: VideoFrame | null) {
  // Close previous playback frame
  const prevFrame = frames.get(clipId)
  if (prevFrame) {
    prevFrame.close()
  }

  if (frame) {
    frames.set(clipId, frame)
  } else {
    frames.delete(clipId)
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
      if (previewFrame) {
        previewFrame.close()
      }
      previewFrame = frame
    }
  } catch (error) {
    log('readPreviewStream: error', { trackId, error })
  }

  previewReaders.delete(trackId)
  log('readPreviewStream: ended', { trackId })
}

function updateRenderStats(
  time: number,
  frame: VideoFrame | null | undefined,
  placement: Placement,
  isPreview: boolean,
) {
  if (!frame) {
    renderStats.dropped++
    return
  }
  const frameKey = isPreview ? `preview-${placement.trackId}` : placement.clipId
  const lastInfo = lastRenderedFrame.get(frameKey)

  // Check for stale frame - only count as stale if a new frame SHOULD be available
  if (lastInfo && frame.timestamp === lastInfo.timestamp && lastInfo.duration > 0) {
    // Same frame as before - check if current render time exceeds frame's valid period
    const frameEndTime = (lastInfo.timestamp + lastInfo.duration) / 1_000_000
    if (time >= frameEndTime) {
      // Render time is past when next frame should be available - this is truly stale
      renderStats.stale++
    }
  }

  lastRenderedFrame.set(frameKey, {
    timestamp: frame.timestamp,
    duration: frame.duration ?? 0,
  })

  renderStats.rendered++
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
    mainEngine = makeVideoCompositor(offscreenCanvas)

    // Capture canvas (for pre-rendering, same size)
    const captureCanvas = new OffscreenCanvas(width, height)
    captureEngine = makeVideoCompositor(captureCanvas)
  },

  setTimeline(newTimeline) {
    compiledTimeline = newTimeline
    log('setTimeline', {
      duration: compiledTimeline.duration,
      segments: compiledTimeline.segments.length,
    })
  },

  setTrackVideoPipeline(trackId, pipeline) {
    log('setTrackVideoPipeline', { trackId, effectCount: pipeline.length })

    if (!mainEngine) {
      log('setTrackVideoPipeline: no engine yet, storing for later')
      trackVideoEffects.set(trackId, { pipeline, compiled: null })
      return
    }

    // Create effect tokens from pipeline
    const effects: VideoEffectToken[] = []
    for (const effect of pipeline) {
      const token = createVideoEffect(effect.type, { value: effect.value?.value ?? 0 })
      if (token) {
        effects.push(token)
      }
    }

    if (effects.length === 0) {
      // No effects - remove any existing chain
      if (mainEngine.hasEffectChain(trackId)) {
        mainEngine.deleteEffectChain(trackId)
      }
      trackVideoEffects.delete(trackId)
      return
    }

    // Register effect chain with compositor (or get existing)
    const compiled = mainEngine.registerEffectChain({ id: trackId, effects })

    // If chain already existed, update values from pipeline
    // (registerEffectChain returns cached chain, so new token initial values weren't applied)
    const existing = trackVideoEffects.get(trackId)
    if (existing?.compiled === compiled) {
      // Chain was cached - update each effect's value
      for (let i = 0; i < pipeline.length; i++) {
        const value = pipeline[i].value?.value ?? 0
        const controls = compiled.controls[i]
        if (controls) {
          const setterKey = Object.keys(controls).find(key => key.startsWith('set'))
          if (setterKey && typeof (controls as Record<string, unknown>)[setterKey] === 'function') {
            ;(controls as Record<string, (v: number) => void>)[setterKey](value)
          }
        }
      }
    }

    trackVideoEffects.set(trackId, { pipeline, compiled })

    log('setTrackVideoPipeline: registered chain', { trackId, effectCount: effects.length })
  },

  setTrackVideoEffectValue(trackId, effectIndex, value) {
    const trackEffects = trackVideoEffects.get(trackId)
    if (!trackEffects?.compiled) {
      log('setTrackVideoEffectValue: no compiled chain for track', { trackId })
      return
    }

    const controls = trackEffects.compiled.controls[effectIndex]
    if (!controls) {
      log('setTrackVideoEffectValue: no controls at index', { trackId, effectIndex })
      return
    }

    // Update the control - find the setter method
    // Controls have methods like setBrightness, setContrast, etc.
    const setterKey = Object.keys(controls).find(key => key.startsWith('set'))
    if (setterKey && typeof controls[setterKey] === 'function') {
      controls[setterKey](value)
      log('setTrackVideoEffectValue', { trackId, effectIndex, value })
    }
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
    if (previewFrame) {
      previewFrame.close()
      previewFrame = null
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
    const frame = frames.get(clipId)
    if (frame) {
      frame.close()
      frames.delete(clipId)
    }
  },

  render(time): RenderStats {
    if (!mainEngine || !compiledTimeline) return renderStats

    // Clear canvas
    mainEngine.clear()

    // Query timeline for active placements at this time
    const activePlacements = getActivePlacements(compiledTimeline, time)
    renderStats.expected = activePlacements.length

    // Render all active placements
    for (const { placement } of activePlacements) {
      // Get frame from appropriate source based on clipId
      const isPreview = placement.clipId === PREVIEW_CLIP_ID
      const frame = isPreview ? previewFrame : frames.get(placement.clipId)

      updateRenderStats(time, frame, placement, isPreview)

      if (!frame) {
        continue
      }

      // Use trackId for texture key when preview (avoids collision with playback textures)
      const textureKey = isPreview ? `preview-${placement.trackId}` : placement.clipId

      // Use track's effect chain if registered
      const effectChainId = mainEngine.hasEffectChain(placement.trackId)
        ? placement.trackId
        : undefined

      mainEngine.renderPlacement({
        id: textureKey,
        frame,
        viewport: placement.viewport,
        effectChainId,
      })
    }

    return renderStats
  },

  renderToCaptureCanvas(time) {
    if (!captureEngine || !compiledTimeline) return

    // Query timeline for active placements
    const activePlacements = getActivePlacements(compiledTimeline, time)

    // Render using pre-uploaded textures
    captureEngine.renderById(
      activePlacements.map(({ placement }) => ({
        id: placement.clipId,
        viewport: placement.viewport,
        effectChainId: captureEngine!.hasEffectChain(placement.trackId)
          ? placement.trackId
          : undefined,
      })),
    )
  },

  renderAndCapture(time) {
    if (!mainEngine || !compiledTimeline) return null

    // Clear canvas
    mainEngine.clear()

    // Query timeline for active placements at this time
    const activePlacements = getActivePlacements(compiledTimeline, time)

    // Render all active placements
    for (const { placement } of activePlacements) {
      // Get frame from appropriate source based on clipId
      const isPreview = placement.clipId === PREVIEW_CLIP_ID
      const frame = isPreview ? previewFrame : frames.get(placement.clipId)

      if (!frame) {
        continue
      }

      // Use trackId for texture key when preview (avoids collision with playback textures)
      const textureKey = isPreview ? `preview-${placement.trackId}` : placement.clipId

      // Use track's effect chain if registered
      const effectChainId = mainEngine.hasEffectChain(placement.trackId)
        ? placement.trackId
        : undefined

      mainEngine.renderPlacement({
        id: textureKey,
        frame,
        viewport: placement.viewport,
        effectChainId,
      })
    }

    // Capture the frame (timestamp in microseconds)
    return mainEngine.captureFrame(time * 1_000_000)
  },

  renderFramesAndCapture(time, frameEntries) {
    if (!mainEngine || !compiledTimeline) return null

    // Build a temporary frame map from the provided frames
    const exportFrames = new Map<string, VideoFrame>()
    for (const { clipId, frame } of frameEntries) {
      exportFrames.set(clipId, frame)
    }

    // Clear canvas
    mainEngine.clear()

    // Query timeline for active placements at this time
    const activePlacements = getActivePlacements(compiledTimeline, time)

    // Render all active placements using provided frames
    for (const { placement } of activePlacements) {
      const frame = exportFrames.get(placement.clipId)
      if (!frame) continue

      // Use track's effect chain if registered
      const effectChainId = mainEngine.hasEffectChain(placement.trackId)
        ? placement.trackId
        : undefined

      mainEngine.renderPlacement({
        id: placement.clipId,
        frame,
        viewport: placement.viewport,
        effectChainId,
      })
    }

    // Capture the frame (timestamp in microseconds)
    const capturedFrame = mainEngine.captureFrame(time * 1_000_000)

    // Close the provided frames (they were transferred to us)
    for (const frame of exportFrames.values()) {
      frame.close()
    }

    return capturedFrame
  },

  destroy() {
    log('destroy')

    // Close all frames
    for (const frame of frames.values()) {
      frame.close()
    }
    frames.clear()

    previewFrame?.close()
    previewFrame = null

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
