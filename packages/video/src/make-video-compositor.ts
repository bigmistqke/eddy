/**
 * Make Video Compositor
 *
 * High-level video composition orchestration. Manages frames, preview streams,
 * effect chain compilation, and timeline-based rendering. Uses VideoRenderer
 * for the actual WebGL rendering.
 */

import { debug } from '@eddy/utils'
import type {
  CompiledEffectChain,
  EffectKey,
  EffectManager,
  EffectRegistry,
} from './effect-manager'
import { makeEffectManager } from './effect-manager'
import type { EffectValue } from './effects'
import { makeVideoRenderer, type VideoRenderer } from './make-video-renderer'
import type { CompiledTimeline, EffectParamRef, EffectRef, Placement } from '@eddy/timeline'
import { getActivePlacements } from '@eddy/timeline'

const log = debug('video:make-video-compositor', false)

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

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

/** Configuration for creating a VideoCompositor */
export interface VideoCompositorConfig {
  /** Main canvas for visible rendering */
  canvas: OffscreenCanvas
  /** Canvas dimensions */
  width: number
  height: number
  /** Effect registry for compiling effect chains */
  effectRegistry: EffectRegistry
  /** Clip ID used for preview frames (e.g., camera preview during recording) */
  previewClipId: string
}

/** Track last rendered frame info per clipId for stale detection */
interface LastFrameInfo {
  /** VideoFrame.timestamp (microseconds) */
  timestamp: number
  /** VideoFrame.duration (microseconds) */
  duration: number
}

export interface VideoCompositor {
  /** The main renderer (for external access if needed) */
  readonly mainRenderer: VideoRenderer
  /** The capture renderer (for pre-rendering) */
  readonly captureRenderer: VideoRenderer
  /** The main effect manager */
  readonly mainEffectManager: EffectManager
  /** The capture effect manager */
  readonly captureEffectManager: EffectManager

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
  setFrame(clipId: string, frame: VideoFrame | null): void

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
/*                                     Utils                                      */
/*                                                                                */
/**********************************************************************************/

/** Create onBeforeRender callback that applies effect values to controls */
function makeOnBeforeRender(
  chain: CompiledEffectChain,
  effectRefs: EffectRef[],
  effectParamRefs: EffectParamRef[],
  effectValues: Map<string, EffectValue>,
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

/**********************************************************************************/
/*                                                                                */
/*                              Make Video Compositor                             */
/*                                                                                */
/**********************************************************************************/

/**
 * Create a video compositor for orchestrating frame rendering.
 * Manages frames, preview streams, effect chains, and timeline-based composition.
 */
export function makeVideoCompositor(config: VideoCompositorConfig): VideoCompositor {
  const { canvas, width, height, effectRegistry, previewClipId } = config

  // Renderers
  const mainRenderer = makeVideoRenderer(canvas)
  const captureCanvas = new OffscreenCanvas(width, height)
  const captureRenderer = makeVideoRenderer(captureCanvas)

  // Effect managers (one per renderer, sharing GL context)
  const mainEffectManager = makeEffectManager(mainRenderer.gl, effectRegistry)
  const captureEffectManager = makeEffectManager(captureRenderer.gl, effectRegistry)

  // Current compiled timeline
  let compiledTimeline: CompiledTimeline | null = null

  // Frame sources - keyed by clipId
  const frames = new Map<string, VideoFrame>()

  // Preview frames - keyed by trackId (for camera preview during recording)
  let previewFrame: VideoFrame | null = null
  const previewReaders = new Map<string, ReadableStreamDefaultReader<VideoFrame>>()

  // Track last rendered frame info per clipId for stale detection
  const lastRenderedFrame = new Map<string, LastFrameInfo>()

  // Effect chains cached by effectSignature (hash of effect types)
  const effectChainsBySignature = new Map<string, CompiledEffectChain>()

  // Effect values keyed by pre-computed key from EffectRef
  const effectValues = new Map<string, EffectValue>()

  // Render stats (reset each frame)
  let renderStats: RenderStats = { expected: 0, rendered: 0, dropped: 0, stale: 0 }

  log('VideoCompositor initialized', { width, height })

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

  function setFrame(clipId: string, frame: VideoFrame | null): void {
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

  async function readPreviewStream(
    trackId: string,
    stream: ReadableStream<VideoFrame>,
  ): Promise<void> {
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
  ): void {
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

  return {
    get mainRenderer() {
      return mainRenderer
    },

    get captureRenderer() {
      return captureRenderer
    },

    get mainEffectManager() {
      return mainEffectManager
    },

    get captureEffectManager() {
      return captureEffectManager
    },

    setFrame,

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

    render(time): RenderStats {
      if (!compiledTimeline) return renderStats

      // Reset stats
      renderStats = { expected: 0, rendered: 0, dropped: 0, stale: 0 }

      // Clear canvas
      mainRenderer.clear()

      // Query timeline for active placements at this time
      const activePlacements = getActivePlacements(compiledTimeline, time)
      renderStats.expected = activePlacements.length

      // Render all active placements
      for (const { placement } of activePlacements) {
        // Get frame from appropriate source based on clipId
        const isPreview = placement.clipId === previewClipId
        const frame = isPreview ? previewFrame : frames.get(placement.clipId)

        updateRenderStats(time, frame, placement, isPreview)

        if (!frame) {
          continue
        }

        // Use trackId for texture key when preview (avoids collision with playback textures)
        const textureKey = isPreview ? `preview-${placement.trackId}` : placement.clipId

        // Get or compile effect chain from placement's signature
        const effectChain = getOrCompileEffectChain(mainEffectManager, placement)

        mainRenderer.renderPlacement({
          id: textureKey,
          frame,
          viewport: placement.viewport,
          effectChain,
          onBeforeRender: effectChain
            ? makeOnBeforeRender(
                effectChain,
                placement.effectRefs,
                placement.effectParamRefs,
                effectValues,
              )
            : undefined,
        })
      }

      return renderStats
    },

    renderToCaptureCanvas(time) {
      if (!compiledTimeline) return

      // Query timeline for active placements
      const activePlacements = getActivePlacements(compiledTimeline, time)

      // Render using pre-uploaded textures
      captureRenderer.renderById(
        activePlacements.map(({ placement }) => {
          const effectChain = getOrCompileEffectChain(captureEffectManager, placement)
          return {
            id: placement.clipId,
            viewport: placement.viewport,
            effectChain: effectChain ?? undefined,
            onBeforeRender: effectChain
              ? makeOnBeforeRender(
                  effectChain,
                  placement.effectRefs,
                  placement.effectParamRefs,
                  effectValues,
                )
              : undefined,
          }
        }),
      )
    },

    renderAndCapture(time) {
      if (!compiledTimeline) return null

      // Clear canvas
      mainRenderer.clear()

      // Query timeline for active placements at this time
      const activePlacements = getActivePlacements(compiledTimeline, time)

      // Render all active placements
      for (const { placement } of activePlacements) {
        // Get frame from appropriate source based on clipId
        const isPreview = placement.clipId === previewClipId
        const frame = isPreview ? previewFrame : frames.get(placement.clipId)

        if (!frame) {
          continue
        }

        // Use trackId for texture key when preview (avoids collision with playback textures)
        const textureKey = isPreview ? `preview-${placement.trackId}` : placement.clipId

        // Get or compile effect chain from placement's signature
        const effectChain = getOrCompileEffectChain(mainEffectManager, placement)

        mainRenderer.renderPlacement({
          id: textureKey,
          frame,
          viewport: placement.viewport,
          effectChain: effectChain ?? undefined,
          onBeforeRender: effectChain
            ? makeOnBeforeRender(
                effectChain,
                placement.effectRefs,
                placement.effectParamRefs,
                effectValues,
              )
            : undefined,
        })
      }

      // Capture the frame (timestamp in microseconds)
      return mainRenderer.captureFrame(time * 1_000_000)
    },

    renderFramesAndCapture(time, frameEntries) {
      if (!compiledTimeline) return null

      // Build a temporary frame map from the provided frames
      const exportFrames = new Map<string, VideoFrame>()
      for (const { clipId, frame } of frameEntries) {
        exportFrames.set(clipId, frame)
      }

      // Clear canvas
      mainRenderer.clear()

      // Query timeline for active placements at this time
      const activePlacements = getActivePlacements(compiledTimeline, time)

      // Render all active placements using provided frames
      for (const { placement } of activePlacements) {
        const frame = exportFrames.get(placement.clipId)
        if (!frame) continue

        // Get or compile effect chain from placement's signature
        const effectChain = getOrCompileEffectChain(mainEffectManager, placement)

        mainRenderer.renderPlacement({
          id: placement.clipId,
          frame,
          viewport: placement.viewport,
          effectChain: effectChain ?? undefined,
          onBeforeRender: effectChain
            ? makeOnBeforeRender(
                effectChain,
                placement.effectRefs,
                placement.effectParamRefs,
                effectValues,
              )
            : undefined,
        })
      }

      // Capture the frame (timestamp in microseconds)
      const capturedFrame = mainRenderer.captureFrame(time * 1_000_000)

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

      // Destroy renderers
      mainRenderer.destroy()
      captureRenderer.destroy()

      // Destroy effect managers
      mainEffectManager.destroy()
      captureEffectManager.destroy()
    },
  }
}
