import { expose, type Transferred } from '@bigmistqke/rpc/messenger'
import { debug } from '@eddy/utils'
import {
  makeBrightnessEffect,
  makeColorizeEffect,
  makeContrastEffect,
  makeEffectManager,
  makeEffectRegistry,
  makeSaturationEffect,
  makeVideoCompositor,
  type CompiledEffectChain,
  type EffectKey,
  type EffectManager,
  type EffectValue,
  type VideoCompositor,
} from '@eddy/video'
import { PREVIEW_CLIP_ID } from '~/constants'
import {
  getActivePlacements,
  type CompiledTimeline,
  type EffectParamRef,
  type EffectRef,
  type Placement,
} from '@eddy/timeline'

/** Map of effect type names to factory functions */
export const effectCatalog = {
  'visual.brightness': makeBrightnessEffect,
  'visual.colorize': makeColorizeEffect,
  'visual.contrast': makeContrastEffect,
  'visual.saturation': makeSaturationEffect,
} as const

// Create effect registry from catalog
const effectRegistry = makeEffectRegistry(effectCatalog)

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

export interface CompositorWorkerMethods {
  /** Initialize with OffscreenCanvas */
  init(canvas: OffscreenCanvas, width: number, height: number): Promise<void>

  /** Set the compiled layout timeline */
  setTimeline(timeline: CompiledTimeline): void

  /**
   * Set an effect param value by source coordinates.
   * @param sourceType - 'clip' | 'track' | 'group' | 'master'
   * @param sourceId - ID of the source (clipId, trackId, groupId, or 'master')
   * @param effectIndex - Index within that source's effect pipeline
   * @param paramKey - Parameter key within the effect (e.g., 'value', 'color', 'intensity')
   * @param value - The effect value (scalar or vector, already scaled appropriately)
   */
  setEffectValue(
    sourceType: 'clip' | 'track' | 'group' | 'master',
    sourceId: string,
    effectIndex: number,
    paramKey: string,
    value: EffectValue,
  ): void

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

// Compositors
let mainCompositor: VideoCompositor | null = null
let captureCompositor: VideoCompositor | null = null

// Effect managers (one per compositor, sharing GL context)
let mainEffectManager: EffectManager | null = null
let captureEffectManager: EffectManager | null = null

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

// Effect chains cached by effectSignature (hash of effect types)
const effectChainsBySignature = new Map<string, CompiledEffectChain>()

// Effect values keyed by pre-computed key from EffectRef
const effectValues = new Map<string, EffectValue>()

/** Create onBeforeRender callback that applies effect values to controls */
function makeOnBeforeRender(
  chain: CompiledEffectChain,
  effectRefs: EffectRef[],
  effectParamRefs: EffectParamRef[],
): () => void {
  return () => {
    for (let index = 0; index < effectRefs.length; index++) {
      const value = effectValues.get(effectRefs[index].key)
      if (value === undefined) continue

      const paramRef = effectParamRefs[index]
      const control = chain.controls[paramRef.chainIndex]
      if (!control || typeof control[paramRef.paramKey] !== 'function') continue

      control[paramRef.paramKey](value)
    }
  }
}

/**
 * Get or compile an effect chain for a given signature.
 * Compiles lazily on first encounter.
 */
function getOrCompileEffectChain(
  effectManager: EffectManager,
  { effectId, effectKeys }: { effectId: string; effectKeys: EffectKey[] },
): CompiledEffectChain | undefined {
  if (!effectId || effectKeys.length === 0) return undefined

  // Check cache (skip registerEffectChain call if we already have it)
  const cached = effectChainsBySignature.get(effectId)
  if (cached) return cached

  // Register with effect manager (uses signature as ID for caching)
  const compiled = effectManager.registerEffectChain({ effectId, effectKeys })
  effectChainsBySignature.set(effectId, compiled)

  log('Compiled effect chain', { id: effectId, effectCount: effectKeys.length })

  return compiled
}

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
    mainCompositor = makeVideoCompositor(offscreenCanvas)
    mainEffectManager = makeEffectManager(mainCompositor.gl, effectRegistry)

    // Capture canvas (for pre-rendering, same size)
    const captureCanvas = new OffscreenCanvas(width, height)
    captureCompositor = makeVideoCompositor(captureCanvas)
    captureEffectManager = makeEffectManager(captureCompositor.gl, effectRegistry)
  },

  setTimeline(newTimeline) {
    compiledTimeline = newTimeline
    log('setTimeline', {
      duration: compiledTimeline.duration,
      segments: compiledTimeline.segments.length,
    })
  },

  setEffectValue(sourceType, sourceId, effectIndex, paramKey, value) {
    const key = `${sourceType}:${sourceId}:${effectIndex}:${paramKey}`
    effectValues.set(key, value)
    log('setEffectValue', { key, value })
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
    if (!mainCompositor || !mainEffectManager || !compiledTimeline) return renderStats

    // Clear canvas
    mainCompositor.clear()

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

      // Get or compile effect chain from placement's signature
      const effectChain = getOrCompileEffectChain(mainEffectManager, placement)

      mainCompositor.renderPlacement({
        id: textureKey,
        frame,
        viewport: placement.viewport,
        effectChain,
        onBeforeRender: effectChain
          ? makeOnBeforeRender(effectChain, placement.effectRefs, placement.effectParamRefs)
          : undefined,
      })
    }

    return renderStats
  },

  renderToCaptureCanvas(time) {
    if (!captureCompositor || !captureEffectManager || !compiledTimeline) return

    // Query timeline for active placements
    const activePlacements = getActivePlacements(compiledTimeline, time)

    // Render using pre-uploaded textures
    captureCompositor.renderById(
      activePlacements.map(({ placement }) => {
        const effectChain = getOrCompileEffectChain(captureEffectManager!, placement)
        return {
          id: placement.clipId,
          viewport: placement.viewport,
          effectChain: effectChain ?? undefined,
          onBeforeRender: effectChain
            ? makeOnBeforeRender(effectChain, placement.effectRefs, placement.effectParamRefs)
            : undefined,
        }
      }),
    )
  },

  renderAndCapture(time) {
    if (!mainCompositor || !mainEffectManager || !compiledTimeline) return null

    // Clear canvas
    mainCompositor.clear()

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

      // Get or compile effect chain from placement's signature
      const effectChain = getOrCompileEffectChain(mainEffectManager, placement)

      mainCompositor.renderPlacement({
        id: textureKey,
        frame,
        viewport: placement.viewport,
        effectChain: effectChain ?? undefined,
        onBeforeRender: effectChain
          ? makeOnBeforeRender(effectChain, placement.effectRefs, placement.effectParamRefs)
          : undefined,
      })
    }

    // Capture the frame (timestamp in microseconds)
    return mainCompositor.captureFrame(time * 1_000_000)
  },

  renderFramesAndCapture(time, frameEntries) {
    if (!mainCompositor || !mainEffectManager || !compiledTimeline) return null

    // Build a temporary frame map from the provided frames
    const exportFrames = new Map<string, VideoFrame>()
    for (const { clipId, frame } of frameEntries) {
      exportFrames.set(clipId, frame)
    }

    // Clear canvas
    mainCompositor.clear()

    // Query timeline for active placements at this time
    const activePlacements = getActivePlacements(compiledTimeline, time)

    // Render all active placements using provided frames
    for (const { placement } of activePlacements) {
      const frame = exportFrames.get(placement.clipId)
      if (!frame) continue

      // Get or compile effect chain from placement's signature
      const effectChain = getOrCompileEffectChain(mainEffectManager, placement)

      mainCompositor.renderPlacement({
        id: placement.clipId,
        frame,
        viewport: placement.viewport,
        effectChain: effectChain ?? undefined,
        onBeforeRender: effectChain
          ? makeOnBeforeRender(effectChain, placement.effectRefs, placement.effectParamRefs)
          : undefined,
      })
    }

    // Capture the frame (timestamp in microseconds)
    const capturedFrame = mainCompositor.captureFrame(time * 1_000_000)

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

    // Destroy compositors
    mainCompositor?.destroy()
    captureCompositor?.destroy()

    // Destroy effect managers
    mainEffectManager?.destroy()
    captureEffectManager?.destroy()

    mainCompositor = null
    mainEffectManager = null
    captureEffectManager = null
    captureCompositor = null
  },
})
