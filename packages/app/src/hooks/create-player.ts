import { $MESSENGER, rpc, transfer, type RPC } from '@bigmistqke/rpc/messenger'
import type { Project } from '@eddy/lexicons'
import { debug, getGlobalPerfMonitor } from '@eddy/utils'
import { createEffect, createMemo, on, type Accessor } from 'solid-js'
import type { LayoutTimeline } from '~/lib/layout-types'
import { compileLayoutTimeline } from '~/lib/layout-resolver'
import type { CompositorWorkerMethods } from '~/workers/compositor.worker'
import CompositorWorker from '~/workers/compositor.worker?worker'
import { createClock, type Clock } from './create-clock'
import { createSlot, type Slot } from './create-slot'

type CompositorRPC = RPC<CompositorWorkerMethods>

const log = debug('player', false)
const perf = getGlobalPerfMonitor()

export interface PlayerState {
  /** Whether currently playing */
  isPlaying: Accessor<boolean>
  /** Current playback time */
  time: Accessor<number>
  /** Whether loop is enabled */
  loop: Accessor<boolean>
  /** Max duration across all clips */
  maxDuration: Accessor<number>
}

export interface PlayerActions {
  /** Start playback from time */
  play: (time?: number) => Promise<void>
  /** Pause playback */
  pause: () => void
  /** Stop and seek to beginning */
  stop: () => Promise<void>
  /** Seek to time */
  seek: (time: number) => Promise<void>
  /** Toggle loop */
  setLoop: (enabled: boolean) => void
  /** Load a clip into a track */
  loadClip: (trackId: string, blob: Blob) => Promise<void>
  /** Clear a clip from a track */
  clearClip: (trackId: string) => void
  /** Check if track has a clip */
  hasClip: (trackId: string) => boolean
  /** Check if track is currently loading a clip */
  isLoading: (trackId: string) => boolean
  /** Set preview stream for recording */
  setPreviewSource: (trackId: string, stream: MediaStream | null) => void
  /** Set track volume */
  setVolume: (trackId: string, value: number) => void
  /** Set track pan */
  setPan: (trackId: string, value: number) => void
  /** Clean up all resources */
  destroy: () => void
}

export type Compositor = Omit<CompositorRPC, 'init' | 'setPreviewStream'> & {
  canvas: HTMLCanvasElement
  /** Takes MediaStream (converted to ReadableStream internally) */
  setPreviewStream(trackId: string, stream: MediaStream | null): void
}

export interface Player extends PlayerState, PlayerActions {
  /** The canvas element */
  canvas: HTMLCanvasElement
  /** The compositor */
  compositor: Compositor
  /** Clock for time management */
  clock: Clock
  /** Current layout timeline (reactive) */
  timeline: Accessor<LayoutTimeline>
  /** Get track slot by trackId */
  getSlot: (trackId: string) => Slot | undefined
  /** Performance logging */
  logPerf: () => void
  resetPerf: () => void
}

// Expose perf monitor globally for console debugging
if (typeof window !== 'undefined') {
  ;(window as any).eddy = { perf }
}

export interface CreatePlayerOptions {
  canvas: HTMLCanvasElement
  width: number
  height: number
  project: Accessor<Project>
}

/**
 * Create a player that manages compositor, playbacks, and audio pipelines
 */
export async function createPlayer(options: CreatePlayerOptions): Promise<Player> {
  const { canvas: canvasElement, width, height, project } = options
  log('createPlayer', { width, height })

  // Set canvas size and transfer to worker
  canvasElement.width = width
  canvasElement.height = height
  const offscreen = canvasElement.transferControlToOffscreen()

  // Create compositor worker
  const worker = rpc<CompositorWorkerMethods>(new CompositorWorker())
  await worker.init(transfer(offscreen) as unknown as OffscreenCanvas, width, height)

  // Track preview processors for cleanup (keyed by trackId)
  const previewProcessors = new Map<string, MediaStreamTrackProcessor<VideoFrame>>()

  // Create compositor wrapper without mutating the RPC proxy
  const compositor: Compositor = {
    canvas: canvasElement,

    // Delegate to worker methods
    setTimeline: worker.setTimeline,
    setFrame: worker.setFrame,
    render: worker.render,
    setCaptureFrame: worker.setCaptureFrame,
    renderCapture: worker.renderCapture,
    captureFrame: worker.captureFrame,

    setPreviewStream(trackId: string, stream: MediaStream | null) {
      // Clean up existing processor
      previewProcessors.delete(trackId)

      if (stream) {
        const videoTrack = stream.getVideoTracks()[0]
        if (videoTrack) {
          const processor = new MediaStreamTrackProcessor({ track: videoTrack })
          previewProcessors.set(trackId, processor)
          worker.setPreviewStream(
            trackId,
            transfer(processor.readable) as unknown as ReadableStream<VideoFrame>,
          )
        }
      } else {
        worker.setPreviewStream(trackId, null)
      }
    },

    async destroy() {
      previewProcessors.clear()
      await worker.destroy()
      worker[$MESSENGER].terminate()
    },
  }

  // Compile layout timeline from project (reactive)
  const timeline = createMemo(() => {
    const currentProject = project()
    return compileLayoutTimeline(currentProject, { width, height })
  })

  // Create slots map - keyed by trackId
  const slots = new Map<string, Slot>()

  // Helper to get or create slot for a trackId
  function getOrCreateSlot(trackId: string): Slot {
    let slot = slots.get(trackId)
    if (!slot) {
      slot = createSlot({ trackId, compositor })
      slots.set(trackId, slot)
    }
    return slot
  }

  // Sync slots with timeline when project changes
  createEffect(
    on(timeline, currentTimeline => {
      // Update compositor with new timeline
      compositor.setTimeline(currentTimeline)

      // Get trackIds from timeline
      const activeTrackIds = new Set(currentTimeline.slots.map(slot => slot.trackId))

      // Ensure slots exist for all active tracks
      for (const trackId of activeTrackIds) {
        getOrCreateSlot(trackId)
      }

      // Note: We don't destroy old slots immediately in case they're still needed
      // They'll be garbage collected when the player is destroyed
    }),
  )

  // Derived max duration from timeline or playbacks
  const maxDuration = createMemo(() => {
    // First check timeline duration
    const timelineDuration = timeline().duration
    if (timelineDuration > 0) return timelineDuration

    // Fall back to playback durations (for when clips are loaded but not yet in project)
    let max = 0
    for (const slot of slots.values()) {
      const playback = slot.playback()
      if (playback) {
        max = Math.max(max, playback.duration)
      }
    }
    return max
  })

  // Create clock for time management (reads maxDuration reactively)
  const clock = createClock({ duration: maxDuration })

  // Render loop state
  let animationFrameId: number | null = null

  /**
   * Single render loop - drives everything
   */
  function renderLoop() {
    perf.start('renderLoop')

    const time = clock.tick()
    const playing = clock.isPlaying()

    // Handle loop reset
    if (playing && clock.loop() && maxDuration() > 0 && time >= maxDuration()) {
      for (const slot of slots.values()) {
        slot.resetForLoop(0)
      }
    }

    perf.start('getFrames')
    for (const slot of slots.values()) {
      slot.renderFrame(time, playing)
    }
    perf.end('getFrames')

    // Render at current time (compositor queries timeline internally)
    compositor.render(time)

    perf.end('renderLoop')

    animationFrameId = requestAnimationFrame(renderLoop)
  }

  function startRenderLoop() {
    if (animationFrameId !== null) return
    animationFrameId = requestAnimationFrame(renderLoop)
  }

  function stopRenderLoop() {
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }
  }

  function destroy(): void {
    stopRenderLoop()
    for (const slot of slots.values()) {
      slot.destroy()
    }
    slots.clear()
    compositor.destroy()
  }

  // Start render loop
  startRenderLoop()

  return {
    // Canvas
    canvas: compositor.canvas,
    compositor,
    clock,
    timeline,

    // State (reactive)
    isPlaying: clock.isPlaying,
    time: clock.time,
    loop: clock.loop,
    maxDuration,

    // Actions
    async play(time?: number): Promise<void> {
      const startTime = time ?? clock.time()
      log('play', { startTime })

      // Prepare all playbacks
      const slotArray = Array.from(slots.values())
      await Promise.all(slotArray.map(slot => slot.prepareToPlay(startTime)))

      // Start audio
      for (const slot of slots.values()) {
        slot.startAudio(startTime)
      }

      clock.play(startTime)
    },
    pause() {
      if (!clock.isPlaying()) return

      for (const slot of slots.values()) {
        slot.pause()
      }

      clock.pause()
    },
    async stop(): Promise<void> {
      clock.stop()

      for (const slot of slots.values()) {
        slot.stop()
      }

      // Seek to 0
      const slotArray = Array.from(slots.values())
      await Promise.all(slotArray.map(slot => slot.seek(0)))
    },
    async seek(time: number): Promise<void> {
      const wasPlaying = clock.isPlaying()

      if (wasPlaying) {
        clock.pause()
      }

      const slotArray = Array.from(slots.values())
      await Promise.all(slotArray.map(slot => slot.seek(time)))

      clock.seek(time)

      if (wasPlaying) {
        clock.play(time)
      }
    },
    setLoop: clock.setLoop,
    async loadClip(trackId: string, blob: Blob): Promise<void> {
      log('loadClip', { trackId, blobSize: blob.size })
      const slot = getOrCreateSlot(trackId)
      await slot.load(blob)
      log('loadClip complete', { trackId })
    },
    clearClip(trackId: string): void {
      const slot = slots.get(trackId)
      slot?.clear()
    },
    hasClip(trackId: string): boolean {
      return slots.get(trackId)?.hasClip() ?? false
    },
    isLoading(trackId: string): boolean {
      return slots.get(trackId)?.isLoading() ?? false
    },
    setPreviewSource(trackId: string, stream: MediaStream | null): void {
      const slot = getOrCreateSlot(trackId)
      slot.setPreviewSource(stream)
    },
    setVolume(trackId: string, value: number): void {
      slots.get(trackId)?.setVolume(value)
    },
    setPan(trackId: string, value: number): void {
      slots.get(trackId)?.setPan(value)
    },
    destroy,

    // Utilities
    getSlot: (trackId: string) => slots.get(trackId),
    logPerf: () => perf.logSummary(),
    resetPerf: () => perf.reset(),
  }
}
