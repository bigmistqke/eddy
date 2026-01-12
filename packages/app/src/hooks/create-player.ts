import { rpc, transfer, type RPC } from '@bigmistqke/rpc/messenger'
import type { Project } from '@eddy/lexicons'
import { createAudioPipeline, type AudioPipeline } from '@eddy/mixer'
import { debug, getGlobalPerfMonitor } from '@eddy/utils'
import { createEffect, createMemo, createSignal, on, type Accessor } from 'solid-js'
import { createStore } from 'solid-js/store'
import type { CompiledTimeline } from '~/lib/layout-types'
import type { SchedulerBuffer } from '~/lib/scheduler'
import { compileLayoutTimeline, injectPreviewClips } from '~/lib/timeline-compiler'
import { createWorkerPool, type PooledWorker } from '~/lib/worker-pool'
import type { CompositorWorkerMethods } from '~/workers/compositor.worker'
import CompositorWorker from '~/workers/compositor.worker?worker'
import type { PlaybackWorkerMethods } from '~/workers/playback.worker'
import PlaybackWorker from '~/workers/playback.worker?worker'
import { createClock, type Clock } from './create-clock'

type CompositorRPC = RPC<CompositorWorkerMethods>
type PlaybackRPC = RPC<PlaybackWorkerMethods>

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
  /** Load a clip into a track. Returns the clipId. */
  loadClip: (trackId: string, blob: Blob, clipId?: string) => Promise<string>
  /** Clear a clip by clipId */
  clearClip: (clipId: string) => void
  /** Check if clip exists and is ready */
  hasClip: (clipId: string) => boolean
  /** Check if clip is currently loading */
  isLoading: (clipId: string) => boolean
  /** Check if any clip exists for a track */
  hasClipForTrack: (trackId: string) => boolean
  /** Check if any clip is loading for a track */
  isLoadingForTrack: (trackId: string) => boolean
  /** Get all clipIds for a track */
  getClipsForTrack: (trackId: string) => string[]
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
  timeline: Accessor<CompiledTimeline>
  /** Get audio pipeline by trackId */
  getAudioPipeline: (trackId: string) => AudioPipeline | undefined
  /** Performance logging */
  logPerf: () => void
  resetPerf: () => void
  /** Get all perf stats (main thread + workers) */
  getAllPerf: () => Promise<{
    main: Record<string, any>
    workers: Record<string, Record<string, any>>
  }>
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
  schedulerBuffer: SchedulerBuffer
}

/** Track entry for audio routing */
interface TrackEntry {
  trackId: string
  audioPipeline: AudioPipeline
}

/** Clip entry for managing playback workers */
interface ClipEntry {
  clipId: string
  trackId: string
  pooledWorker: PooledWorker<PlaybackRPC>
  duration: number
  state: 'idle' | 'loading' | 'ready' | 'playing' | 'paused'
  /** Stored buffer for gapless loop handoff */
  buffer: ArrayBuffer | null
  /** Worker being prepared for loop transition */
  nextWorker: PooledWorker<PlaybackRPC> | null
  /** Whether nextWorker is ready to take over */
  nextWorkerReady: boolean
}

/**
 * Create a player that manages compositor, playback workers, and audio pipelines.
 * Uses direct worker-to-worker frame transfer for video.
 */
export async function createPlayer(options: CreatePlayerOptions): Promise<Player> {
  const { canvas: canvasElement, width, height, project, schedulerBuffer } = options
  log('createPlayer', { width, height, schedulerBuffer })

  // Set canvas size and transfer to worker
  canvasElement.width = width
  canvasElement.height = height
  const offscreen = canvasElement.transferControlToOffscreen()

  // Create compositor worker
  const compositorWorker = new CompositorWorker()
  const compositorRpc = rpc<CompositorWorkerMethods>(compositorWorker)
  await compositorRpc.init(transfer(offscreen), width, height)

  // Track preview processors for cleanup
  const previewProcessors = new Map<string, MediaStreamTrackProcessor<VideoFrame>>()

  // Create compositor wrapper
  const compositor: Compositor = {
    canvas: canvasElement,

    // Delegate to worker methods
    setTimeline: compositorRpc.setTimeline,
    setFrame: compositorRpc.setFrame,
    render: compositorRpc.render,
    connectPlaybackWorker: compositorRpc.connectPlaybackWorker,
    disconnectPlaybackWorker: compositorRpc.disconnectPlaybackWorker,
    renderToCaptureCanvas: compositorRpc.renderToCaptureCanvas,

    setPreviewStream(trackId: string, stream: MediaStream | null) {
      // Clean up existing processor
      previewProcessors.delete(trackId)

      if (stream) {
        const videoTrack = stream.getVideoTracks()[0]
        if (videoTrack) {
          const processor = new MediaStreamTrackProcessor({ track: videoTrack })
          previewProcessors.set(trackId, processor)
          compositorRpc.setPreviewStream(trackId, transfer(processor.readable))
        }
      } else {
        compositorRpc.setPreviewStream(trackId, null)
      }
    },

    async destroy() {
      previewProcessors.clear()
      await compositorRpc.destroy()
      compositorWorker.terminate()
    },
  }

  // Track which tracks are in preview mode
  const [previewTracks, setPreviewTracks] = createSignal<Set<string>>(new Set())

  // Compile layout timeline from project (reactive)
  // Injects preview clips for tracks in preview mode
  const timeline = createMemo(() => {
    const _previewTracks = previewTracks()
    const projectWithPreviews = injectPreviewClips(project(), _previewTracks)
    return compileLayoutTimeline(projectWithPreviews, { width, height })
  })

  // Worker pool for playback workers
  const workerPool = createWorkerPool<PlaybackRPC>({
    create: () => new PlaybackWorker(),
    wrap: worker => rpc<PlaybackWorkerMethods>(worker),
    maxSize: 8,
  })

  // Track entries - keyed by trackId (audio routing only)
  const [tracks, setTracks] = createStore<Record<string, TrackEntry>>({})

  // Clip entries - keyed by clipId (playback workers)
  // Note: Use unwrap() when accessing worker RPC methods to avoid SolidJS proxy issues
  const [clips, setClips] = createStore<Record<string, ClipEntry>>({})

  /** Get or create a track entry (audio pipeline only) */
  function getOrCreateTrack(trackId: string): TrackEntry {
    const track = tracks[trackId]

    if (track) {
      return track
    }

    log('creating track entry', { trackId })

    const newTrack: TrackEntry = {
      trackId,
      audioPipeline: createAudioPipeline(),
    }
    setTracks(trackId, newTrack)

    return newTrack
  }

  /** Get or create a clip entry (playback worker) */
  function getOrCreateClip(clipId: string, trackId: string): ClipEntry {
    const clip = clips[clipId]

    if (clip) {
      return clip
    }

    log('creating clip entry', { clipId, trackId })

    // Acquire worker from pool
    const pooledWorker = workerPool.acquire()

    // Pass scheduler buffer if available
    pooledWorker.rpc.setSchedulerBuffer(schedulerBuffer)

    // Create MessageChannel for worker-to-worker communication
    const channel = new MessageChannel()

    // Send port1 to compositor (compositor listens)
    compositorRpc.connectPlaybackWorker(clipId, transfer(channel.port1))

    // Send port2 to playback worker (playback worker sends)
    pooledWorker.rpc.connectToCompositor(clipId, transfer(channel.port2))

    const newClip: ClipEntry = {
      clipId,
      trackId,
      pooledWorker,
      duration: 0,
      state: 'idle',
      buffer: null,
      nextWorker: null,
      nextWorkerReady: false,
    }
    setClips(clipId, newClip)

    return newClip
  }

  /** Remove a clip entry */
  function removeClip(clipId: string): void {
    const clip = clips[clipId]

    if (!clip) return

    log('removing clip entry', { clipId })

    // Disconnect from compositor
    compositorRpc.disconnectPlaybackWorker(clipId)

    // Release worker back to pool
    workerPool.release(clip.pooledWorker)

    // Release nextWorker if it exists
    if (clip.nextWorker) {
      workerPool.release(clip.nextWorker)
    }

    setClips(clipId, undefined!)
  }

  /** Remove a track entry */
  function removeTrack(trackId: string): void {
    const track = tracks[trackId]

    if (!track) return

    log('removing track entry', { trackId })

    // Remove all clips for this track
    for (const clip of Object.values(clips)) {
      if (clip.trackId === trackId) {
        removeClip(clip.clipId)
      }
    }

    // Disconnect audio pipeline
    track.audioPipeline.disconnect()

    setTracks(trackId, undefined!)
  }

  // Sync timeline with compositor when project changes
  createEffect(
    on(timeline, currentTimeline => {
      compositor.setTimeline(currentTimeline)
    }),
  )

  /** How far ahead to start preparing the next worker for loop (seconds) */
  const LOOP_PREPARE_AHEAD = 2.0

  /**
   * Prepare a fresh worker for gapless loop transition.
   * Called when approaching end of clip with looping enabled.
   *
   * The new worker loads and buffers frames internally, but is NOT connected
   * to the compositor yet. This allows the old worker to keep sending frames
   * until the exact moment of handoff.
   */
  async function prepareNextWorker(clip: ClipEntry): Promise<void> {
    // Skip if already preparing or no buffer stored
    if (clip.nextWorker) {
      log('prepareNextWorker: already has nextWorker')
      return
    }
    if (!clip.buffer) {
      log('prepareNextWorker: no buffer stored!', clip.clipId)
      return
    }

    log('prepareNextWorker: starting', clip.clipId)

    // Acquire a fresh worker
    const nextWorker = workerPool.acquire()

    // Store it immediately (to prevent duplicate preparations)
    setClips(clip.clipId, 'nextWorker', nextWorker)
    setClips(clip.clipId, 'nextWorkerReady', false)

    try {
      // Load the same buffer
      await nextWorker.rpc.load(clip.buffer)

      // DON'T connect to compositor yet - let old worker keep sending frames
      // Just seek to 0 to buffer frames internally
      await nextWorker.rpc.seek(0)

      setClips(clip.clipId, 'nextWorkerReady', true)
      log('prepareNextWorker: ready', { clipId: clip.clipId })
    } catch (error) {
      log('prepareNextWorker: failed', { clipId: clip.clipId, error })
      // Clean up on failure
      workerPool.release(nextWorker)
      setClips(clip.clipId, 'nextWorker', null)
      setClips(clip.clipId, 'nextWorkerReady', false)
    }
  }

  /**
   * Perform the worker handoff when loop occurs.
   * Connects the new worker to compositor (which disconnects old worker),
   * then starts playback.
   */
  function performLoopHandoff(clip: ClipEntry): void {
    log('performLoopHandoff: starting', { clipId: clip.clipId })

    if (!clip.nextWorker || !clip.nextWorkerReady) {
      log('performLoopHandoff: nextWorker not ready, falling back to seek')
      // Fallback: seek current worker to 0
      clip.pooledWorker.rpc.seek(0).then(() => {
        clip.pooledWorker.rpc.play(0)
      })
      return
    }

    log('performLoopHandoff: swapping workers')

    const oldWorker = clip.pooledWorker
    const newWorker = clip.nextWorker

    // Connect new worker to compositor (this closes old worker's port)
    const channel = new MessageChannel()
    compositorRpc.connectPlaybackWorker(clip.clipId, transfer(channel.port1))
    newWorker.rpc.connectToCompositor(clip.clipId, transfer(channel.port2))

    // Start playing from 0 - frames are already buffered from prepareNextWorker
    // The stream loop will immediately send the buffered frame at time 0
    newWorker.rpc.play(0)

    // Replace entire clip entry to avoid SolidJS proxy issues with nested object updates
    // Use unwrap to get raw values and avoid spreading proxied objects
    setClips(clip.clipId, {
      pooledWorker: newWorker,
      nextWorker: null,
      nextWorkerReady: false,
    })

    // Release old worker back to pool
    workerPool.release(oldWorker)
    log('performLoopHandoff: done')
  }

  // Derived max duration from timeline or playback workers
  const maxDuration = createMemo(() => {
    // First check timeline duration
    const timelineDuration = timeline().duration
    if (timelineDuration > 0) return timelineDuration

    // Fall back to clip durations
    let max = 0
    for (const clip of Object.values(clips)) {
      max = Math.max(max, clip.duration)
    }
    return max
  })

  // Create clock for time management
  const clock = createClock({ duration: maxDuration })

  // Render loop state
  let animationFrameId: number | null = null
  let prevTime = 0

  /**
   * Render loop - drives compositor rendering and handles looping.
   * Video frames are streamed directly from playback workers to compositor.
   */
  function renderLoop() {
    perf.start('renderLoop')

    const time = clock.tick()
    const playing = clock.isPlaying()
    const looping = clock.loop()
    const duration = maxDuration()

    // Detect loop reset (clock jumped backward while playing)
    if (playing && time < prevTime) {
      log('loop reset detected', { prevTime, time })
      // Perform gapless handoff for all playing clips
      const playingClips = Object.values(clips).filter(clip => clip.state === 'playing')
      for (const clip of playingClips) {
        performLoopHandoff(clip)
      }
    }
    prevTime = time

    // Proactively prepare next workers when approaching end with looping enabled
    if (playing && looping && duration > 0 && time >= duration - LOOP_PREPARE_AHEAD) {
      const playingClips = Object.values(clips).filter(
        clip => clip.state === 'playing' && !clip.nextWorker && clip.buffer,
      )
      for (const clip of playingClips) {
        prepareNextWorker(clip)
      }
    }

    // Render compositor at current time and track frame availability
    compositor.render(time).then(stats => {
      // Track dropped frames (only when playing and expecting frames)
      if (playing && stats.expected > 0) {
        perf.count('frames-expected', stats.expected)
        perf.count('frames-rendered', stats.rendered)
        perf.count('frames-dropped', stats.dropped)
        perf.count('frames-stale', stats.stale)
      }
    })

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

    // Remove all clips
    for (const clipId of Object.keys(clips)) {
      removeClip(clipId)
    }

    // Remove all tracks
    for (const trackId of Object.keys(tracks)) {
      removeTrack(trackId)
    }

    // Destroy worker pool
    workerPool.destroy()

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
    maxDuration,
    destroy,
    isPlaying: clock.isPlaying,
    time: clock.time,
    loop: clock.loop,

    // Actions
    async play(time?: number): Promise<void> {
      const startTime = time ?? clock.time()
      log('play', { startTime })

      // Wait for any loading clips to finish (with timeout)
      const loadingClips = Array.from(Object.values(clips)).filter(clip => clip.state === 'loading')
      if (loadingClips.length > 0) {
        log('waiting for loading clips', { count: loadingClips.length })
        // Poll for loading completion with timeout
        const maxWait = 5000
        const startWait = performance.now()
        while (loadingClips.some(c => c.state === 'loading')) {
          if (performance.now() - startWait > maxWait) {
            log('timeout waiting for clips to load')
            break
          }
          await new Promise(resolve => setTimeout(resolve, 50))
        }
      }

      // Seek all clips to start time first
      const readyClips = Array.from(Object.values(clips)).filter(
        clip => clip.state === 'ready' || clip.state === 'paused',
      )

      log('play: clips ready', { count: readyClips.length })

      await Promise.all(readyClips.map(clip => clip.pooledWorker.rpc.seek(startTime)))

      // Start all playback workers
      for (const clip of readyClips) {
        clip.pooledWorker.rpc.play(startTime)
        setClips(clip.clipId, 'state', 'playing')
      }

      clock.play(startTime)
    },

    pause() {
      if (!clock.isPlaying()) return
      log('pause')

      // Pause all playback workers
      for (const clip of Object.values(clips)) {
        if (clip.state === 'playing') {
          clip.pooledWorker.rpc.pause()
          setClips(clip.clipId, 'state', 'paused')
        }
      }

      clock.pause()
    },

    async stop(): Promise<void> {
      log('stop')
      clock.stop()

      // Pause and seek all playback workers to 0
      // Use unwrap() to get raw objects and avoid SolidJS proxy issues with RPC calls
      for (const clip of Object.values(clips)) {
        // Clean up nextWorker if it exists
        if (clip.nextWorker) {
          workerPool.release(clip.nextWorker)
          setClips(clip.clipId, 'nextWorker', null)
          setClips(clip.clipId, 'nextWorkerReady', false)
        }

        if (clip.state === 'playing') {
          clip.pooledWorker.rpc.pause()
        }
        if (clip.state !== 'idle' && clip.state !== 'loading') {
          await clip.pooledWorker.rpc.seek(0)
          setClips(clip.clipId, 'state', 'ready')
        }
      }
    },

    async seek(time: number): Promise<void> {
      log('seek', { time })
      const wasPlaying = clock.isPlaying()

      if (wasPlaying) {
        clock.pause()
        // Pause all playback workers
        for (const clip of Object.values(clips)) {
          if (clip.state === 'playing') {
            clip.pooledWorker.rpc.pause()
            setClips(clip.clipId, 'state', 'paused')
          }
        }
      }

      // Seek all clips in parallel
      await Promise.all(
        Array.from(Object.values(clips))
          .filter(clip => clip.state !== 'idle' && clip.state !== 'loading')
          .map(clip => clip.pooledWorker.rpc.seek(time)),
      )

      clock.seek(time)

      if (wasPlaying) {
        // Resume playback
        for (const clip of Object.values(clips)) {
          if (clip.state === 'paused') {
            clip.pooledWorker.rpc.play(time)
            setClips(clip.clipId, 'state', 'playing')
          }
        }
        clock.play(time)
      }
    },

    setLoop(enabled: boolean) {
      clock.setLoop(enabled)

      // Clean up any pending nextWorkers when looping is disabled
      if (!enabled) {
        for (const clip of Object.values(clips)) {
          if (clip.nextWorker) {
            log('setLoop: cleaning up nextWorker', { clipId: clip.clipId })
            workerPool.release(clip.nextWorker)
            setClips(clip.clipId, 'nextWorker', null)
            setClips(clip.clipId, 'nextWorkerReady', false)
          }
        }
      }
    },

    async loadClip(trackId: string, blob: Blob, clipId?: string): Promise<string> {
      // Generate clipId if not provided
      const resolvedClipId = clipId ?? `clip-${trackId}-${Date.now()}`
      log('loadClip', { trackId, clipId: resolvedClipId, blobSize: blob.size })

      // Ensure track exists (for audio routing)
      getOrCreateTrack(trackId)

      // Get or create clip entry
      const clip = getOrCreateClip(resolvedClipId, trackId)
      setClips(resolvedClipId, 'state', 'loading')

      // Convert blob to ArrayBuffer and send to worker
      const buffer = await blob.arrayBuffer()
      const { duration } = await clip.pooledWorker.rpc.load(buffer)

      // Store buffer for gapless loop handoff
      setClips(resolvedClipId, 'buffer', buffer)
      setClips(resolvedClipId, 'duration', duration)
      setClips(resolvedClipId, 'state', 'ready')

      // Seek to current time (or 0) to show initial frame
      const currentTime = clock.time()
      await clip.pooledWorker.rpc.seek(currentTime)

      log('loadClip complete', { clipId: resolvedClipId, duration })
      return resolvedClipId
    },

    clearClip(clipId: string): void {
      log('clearClip', { clipId })
      removeClip(clipId)
    },

    hasClip(clipId: string): boolean {
      const clip = clips[clipId]
      return clip?.state === 'ready' || clip?.state === 'playing' || clip?.state === 'paused'
    },

    isLoading(clipId: string): boolean {
      return clips[clipId]?.state === 'loading'
    },

    /** Check if any clip exists for a track (backwards-compatible) */
    hasClipForTrack(trackId: string): boolean {
      return Object.values(clips).some(
        clip =>
          clip.trackId === trackId &&
          (clip.state === 'ready' || clip.state === 'playing' || clip.state === 'paused'),
      )
    },

    /** Check if any clip is loading for a track (backwards-compatible) */
    isLoadingForTrack(trackId: string): boolean {
      return Object.values(clips).some(clip => clip.trackId === trackId && clip.state === 'loading')
    },

    /** Get all clipIds for a track */
    getClipsForTrack(trackId: string): string[] {
      return Object.values(clips)
        .filter(clip => clip.trackId === trackId)
        .map(clip => clip.clipId)
    },

    setPreviewSource(trackId: string, stream: MediaStream | null): void {
      // Update preview tracks set (triggers timeline recompilation)
      setPreviewTracks(prev => {
        const next = new Set(prev)
        if (stream) {
          next.add(trackId)
        } else {
          next.delete(trackId)
        }
        return next
      })

      compositor.setPreviewStream(trackId, stream)
    },

    setVolume(trackId: string, value: number): void {
      tracks[trackId]?.audioPipeline.setVolume(value)
    },

    setPan(trackId: string, value: number): void {
      tracks[trackId]?.audioPipeline.setPan(value)
    },

    // Utilities
    getAudioPipeline: (trackId: string) => tracks[trackId]?.audioPipeline,
    logPerf: () => perf.logSummary(),
    resetPerf: () => {
      perf.reset()
      // Reset worker perf too
      for (const clip of Object.values(clips)) {
        clip.pooledWorker.rpc.resetPerf()
      }
    },
    async getAllPerf() {
      const workerStats: Record<string, Record<string, any>> = {}

      // Collect from all playback workers (keyed by clipId)
      await Promise.all(
        Object.entries(clips).map(async ([clipId, clip]) => {
          try {
            workerStats[clipId] = await clip.pooledWorker.rpc.getPerf()
          } catch {
            // Worker might not be ready
          }
        }),
      )

      return {
        main: perf.getAllStats(),
        workers: workerStats,
      }
    },
  }
}
