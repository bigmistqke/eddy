/**
 * Compositor Worker
 *
 * Thin RPC wrapper around makeVideoCompositor. Handles worker-specific concerns:
 * - RPC exposure via @bigmistqke/rpc/messenger
 * - Worker-to-worker MessagePort connections for frame transfer
 */

import { expose, handle, type Handled } from '@bigmistqke/rpc/messenger'
import { debug, pick } from '@eddy/utils'
import {
  makeBrightnessEffect,
  makeColorizeEffect,
  makeContrastEffect,
  makeEffectRegistry,
  makeSaturationEffect,
  makeVideoCompositor,
  type RenderStats,
  type VideoCompositor,
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
export interface CompositorMethods extends Pick<
  VideoCompositor,
  | 'setProject'
  | 'setEffectValue'
  | 'setFrame'
  | 'render'
  | 'renderToCaptureCanvas'
  | 'renderAndCapture'
  | 'renderFramesAndCapture'
  | 'setPreviewStream'
> {
  /** Connect a playback worker via MessagePort (for direct worker-to-worker frame transfer) */
  connectPlaybackWorker(clipId: string, port: MessagePort): void

  /** Disconnect a playback worker */
  disconnectPlaybackWorker(clipId: string): void

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
      ...pick(compositor, [
        'setProject',
        'setEffectValue',
        'setFrame',
        'render',
        'renderToCaptureCanvas',
        'renderAndCapture',
        'renderFramesAndCapture',
        'setPreviewStream',
      ]),

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
