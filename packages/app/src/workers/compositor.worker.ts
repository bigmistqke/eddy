/**
 * Compositor Worker
 *
 * Thin RPC wrapper around makeVideoCompositor. Handles worker-specific concerns:
 * - RPC exposure via @bigmistqke/rpc/messenger
 * - Worker-to-worker MessagePort connections for frame transfer
 */

import { expose, handle, type Handled, type Transferred } from '@bigmistqke/rpc/messenger'
import type { AbsoluteProject } from '@eddy/lexicons'
import { debug } from '@eddy/utils'
import {
  makeBrightnessEffect,
  makeColorizeEffect,
  makeContrastEffect,
  makeEffectRegistry,
  makeSaturationEffect,
  makeVideoCompositor,
  type EffectValue,
  type RenderStats,
} from '@eddy/video'
import { PREVIEW_CLIP_ID } from '~/constants'

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

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

/** Methods returned by init() as a sub-proxy */
export interface CompositorMethods {
  /** Set the project for timeline-based rendering */
  setProject(project: AbsoluteProject): void

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

export interface CompositorWorkerMethods {
  /** Initialize the compositor with canvas and dimensions, returns methods as sub-proxy */
  init(canvas: OffscreenCanvas, width: number, height: number): Handled<CompositorMethods>
}

// Re-export RenderStats for consumers
export type { RenderStats }

/**********************************************************************************/
/*                                                                                */
/*                                    Expose                                      */
/*                                                                                */
/**********************************************************************************/

expose<CompositorWorkerMethods>({
  init(canvas, width, height) {
    log('init', { width, height })

    const compositor = makeVideoCompositor({
      canvas,
      width,
      height,
      effectRegistry,
      previewClipId: PREVIEW_CLIP_ID,
    })

    // Playback worker connections - keyed by clipId (worker-specific concern)
    const playbackWorkerPorts = new Map<string, MessagePort>()

    return handle({
      setProject(project) {
        compositor.setProject(project)
      },

      setEffectValue(sourceType, sourceId, effectIndex, paramKey, value) {
        compositor.setEffectValue(sourceType, sourceId, effectIndex, paramKey, value)
      },

      setPreviewStream(trackId, stream) {
        compositor.setPreviewStream(trackId, stream)
      },

      setFrame(clipId, frame) {
        compositor.setFrame(clipId, frame as VideoFrame | null)
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
            setFrame(clipId: string, frame: VideoFrame | null) {
              compositor.setFrame(clipId, frame)
            },
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

        // Clear any remaining frame for this clip
        compositor.setFrame(clipId, null)
      },

      render(time) {
        return compositor.render(time)
      },

      renderToCaptureCanvas(time) {
        compositor.renderToCaptureCanvas(time)
      },

      renderAndCapture(time) {
        return compositor.renderAndCapture(time)
      },

      renderFramesAndCapture(time, frameEntries) {
        return compositor.renderFramesAndCapture(time, frameEntries)
      },

      destroy() {
        log('destroy')

        // Close all ports (worker-specific cleanup)
        for (const port of playbackWorkerPorts.values()) {
          port.close()
        }
        playbackWorkerPorts.clear()

        // Destroy compositor
        compositor.destroy()
      },
    } satisfies CompositorMethods)
  },
})
