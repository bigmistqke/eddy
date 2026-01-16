import { rpc, transfer, type RPC } from '@bigmistqke/rpc/messenger'
import { createAudioBus, type AudioBus } from '@eddy/audio'
import type { Project } from '@eddy/lexicons'
import { createLoop, debug, getGlobalPerfMonitor } from '@eddy/utils'
import { createEffect, createMemo, createSignal, on, type Accessor } from 'solid-js'
import { createStore } from 'solid-js/store'
import {
  createPlayback,
  type AudioWorkerRPC,
  type Playback,
  type VideoWorkerRPC,
} from '~/lib/create-playback'
import type { CompiledTimeline } from '~/lib/layout-types'
import type { SchedulerBuffer } from '~/lib/scheduler'
import { compileLayoutTimeline, injectPreviewClips } from '~/lib/timeline-compiler'
import { createWorkerPool } from '~/lib/worker-pool'
import type { CompositorWorkerMethods } from '~/workers/compositor.worker'
import CompositorWorker from '~/workers/compositor.worker?worker'
import type { AudioPlaybackWorkerMethods } from '~/workers/playback.audio.worker'
import AudioPlaybackWorker from '~/workers/playback.audio.worker?worker'
import type { VideoPlaybackWorkerMethods } from '~/workers/playback.video.worker'
import VideoPlaybackWorker from '~/workers/playback.video.worker?worker'
import { createClock, type Clock } from './create-clock'

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
  /** Load a clip into a track (reads from OPFS). Returns the clipId. */
  loadClip: (trackId: string, clipId: string) => Promise<string>
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
  /** Get frame at time from a specific clip (for export) */
  getClipFrameAtTime: (clipId: string, time: number) => Promise<VideoFrame | null>
  /** Set preview stream for recording */
  setPreviewSource: (trackId: string, stream: MediaStream | null) => void
  /** Set track volume */
  setVolume: (trackId: string, value: number) => void
  /** Set track pan */
  setPan: (trackId: string, value: number) => void
  /** Clean up all resources */
  destroy: () => void
  /** Stop the render loop (for export) */
  stopRenderLoop: () => void
  /** Start the render loop */
  startRenderLoop: () => void
}

export type Compositor = Omit<CompositorRPC, 'init' | 'setPreviewStream'> & {
  canvas: HTMLCanvasElement
  /** Takes MediaStream (converted to ReadableStream internally) */
  setPreviewStream(trackId: string, stream: MediaStream | null): void
  /** Render and capture frame for export */
  renderAndCapture(time: number): Promise<VideoFrame | null>
  /** Render with provided frames and capture (for export) */
  renderFramesAndCapture(
    time: number,
    frameEntries: Array<{ clipId: string; frame: VideoFrame }>,
  ): Promise<VideoFrame | null>
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
  getAudioPipeline: (trackId: string) => AudioBus | undefined
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
  audioPipeline: AudioBus
}

/** Clip entry for managing playback (video + audio) */
interface ClipEntry {
  clipId: string
  trackId: string
  /** Orchestrated playback (manages both video and audio workers) */
  playback: Playback
  duration: number
  state: 'idle' | 'loading' | 'ready' | 'playing' | 'paused'
  /** Playback being prepared for loop transition */
  nextPlayback: Playback | null
  /** Whether nextPlayback is ready to take over */
  nextPlaybackReady: boolean
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
    renderAndCapture: compositorRpc.renderAndCapture,
    renderFramesAndCapture: compositorRpc.renderFramesAndCapture,

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

  // Worker pools for video and audio playback
  const videoWorkerPool = createWorkerPool<VideoWorkerRPC>({
    create: () => new VideoPlaybackWorker(),
    wrap: worker => rpc<VideoPlaybackWorkerMethods>(worker),
    maxSize: 8,
  })

  const audioWorkerPool = createWorkerPool<AudioWorkerRPC>({
    create: () => new AudioPlaybackWorker(),
    wrap: worker => rpc<AudioPlaybackWorkerMethods>(worker),
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

    // Look up track's audio effects from project
    const projectTrack = project().tracks.find(t => t.id === trackId)
    const effects = projectTrack?.audioPipeline ?? []

    const newTrack: TrackEntry = {
      trackId,
      audioPipeline: createAudioBus(effects),
    }
    setTracks(trackId, newTrack)

    return newTrack
  }

  /** Get or create a clip entry (orchestrated playback) */
  function getOrCreateClip(clipId: string, trackId: string): ClipEntry {
    const clip = clips[clipId]

    if (clip) {
      return clip
    }

    log('creating clip entry', { clipId, trackId })

    // Get track's audio pipeline for routing
    const track = getOrCreateTrack(trackId)

    // Acquire workers from pools
    const videoWorker = videoWorkerPool.acquire()
    const audioWorker = audioWorkerPool.acquire()

    // Create orchestrated playback
    const playback = createPlayback({
      videoWorker,
      audioWorker,
      schedulerBuffer,
      audioDestination: track.audioPipeline.effectChain.input,
    })

    // Pass scheduler buffer to video worker
    videoWorker.rpc.setSchedulerBuffer(schedulerBuffer)

    // Create MessageChannel for worker-to-worker video frame transfer
    const channel = new MessageChannel()

    // Connect video worker to compositor
    compositorRpc.connectPlaybackWorker(clipId, transfer(channel.port1))
    videoWorker.rpc.connectToCompositor(clipId, transfer(channel.port2))

    const newClip: ClipEntry = {
      clipId,
      trackId,
      playback,
      duration: 0,
      state: 'idle',
      nextPlayback: null,
      nextPlaybackReady: false,
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

    // Destroy playback (cleans up audio scheduler)
    clip.playback.destroy()

    // Release workers back to pools
    videoWorkerPool.release(clip.playback.pooledVideoWorker)
    audioWorkerPool.release(clip.playback.pooledAudioWorker)

    // Release nextPlayback workers if exists
    if (clip.nextPlayback) {
      clip.nextPlayback.destroy()
      videoWorkerPool.release(clip.nextPlayback.pooledVideoWorker)
      audioWorkerPool.release(clip.nextPlayback.pooledAudioWorker)
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
   * Prepare a fresh playback for gapless loop transition.
   * Called when approaching end of clip with looping enabled.
   *
   * The new playback loads and buffers frames internally, but is NOT connected
   * to the compositor yet. This allows the old playback to keep sending frames
   * until the exact moment of handoff.
   */
  async function prepareNextPlayback(clip: ClipEntry): Promise<void> {
    // Skip if already preparing
    if (clip.nextPlayback) {
      log('prepareNextPlayback: already has nextPlayback')
      return
    }

    log('prepareNextPlayback: starting', clip.clipId)

    // Get track's audio pipeline
    const track = tracks[clip.trackId]
    if (!track) {
      log('prepareNextPlayback: no track found')
      return
    }

    // Acquire fresh workers from pools
    const videoWorker = videoWorkerPool.acquire()
    const audioWorker = audioWorkerPool.acquire()

    // Create new playback
    const nextPlayback = createPlayback({
      videoWorker,
      audioWorker,
      schedulerBuffer,
      audioDestination: track.audioPipeline.effectChain.input,
    })

    // Store it immediately (to prevent duplicate preparations)
    setClips(clip.clipId, 'nextPlayback', nextPlayback)
    setClips(clip.clipId, 'nextPlaybackReady', false)

    try {
      // Load from OPFS using the same clipId
      await nextPlayback.load(clip.clipId)

      // DON'T connect to compositor yet - let old playback keep sending frames
      // Just seek to 0 to buffer frames internally
      await nextPlayback.seek(0)

      setClips(clip.clipId, 'nextPlaybackReady', true)
      log('prepareNextPlayback: ready', { clipId: clip.clipId })
    } catch (error) {
      log('prepareNextPlayback: failed', { clipId: clip.clipId, error })
      // Clean up on failure
      nextPlayback.destroy()
      videoWorkerPool.release(videoWorker)
      audioWorkerPool.release(audioWorker)
      setClips(clip.clipId, 'nextPlayback', null)
      setClips(clip.clipId, 'nextPlaybackReady', false)
    }
  }

  /**
   * Perform the playback handoff when loop occurs.
   * Connects the new playback to compositor (which disconnects old playback),
   * then starts playback.
   */
  function performLoopHandoff(clip: ClipEntry): void {
    log('performLoopHandoff: starting', { clipId: clip.clipId })

    if (!clip.nextPlayback || !clip.nextPlaybackReady) {
      log('performLoopHandoff: nextPlayback not ready, falling back to seek')
      // Fallback: seek current playback to 0
      clip.playback.seek(0).then(() => {
        clip.playback.play(0)
      })
      return
    }

    log('performLoopHandoff: swapping playbacks')

    const oldPlayback = clip.playback
    const newPlayback = clip.nextPlayback

    // Connect new video worker to compositor (this closes old worker's port)
    const channel = new MessageChannel()
    compositorRpc.connectPlaybackWorker(clip.clipId, transfer(channel.port1))
    newPlayback.pooledVideoWorker.rpc.connectToCompositor(clip.clipId, transfer(channel.port2))

    // Start playing from 0 - frames are already buffered from prepareNextPlayback
    newPlayback.play(0)

    // Replace entire clip entry to avoid SolidJS proxy issues with nested object updates
    setClips(clip.clipId, {
      playback: newPlayback,
      nextPlayback: null,
      nextPlaybackReady: false,
    })

    // Destroy old playback and release workers back to pools
    oldPlayback.destroy()
    videoWorkerPool.release(oldPlayback.pooledVideoWorker)
    audioWorkerPool.release(oldPlayback.pooledAudioWorker)
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
  let prevTime = 0

  /**
   * Render loop - drives compositor rendering and handles looping.
   * Video frames are streamed directly from playback workers to compositor.
   */
  const renderLoop = createLoop(() => {
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

    // Proactively prepare next playbacks when approaching end with looping enabled
    if (playing && looping && duration > 0 && time >= duration - LOOP_PREPARE_AHEAD) {
      const playingClips = Object.values(clips).filter(
        clip => clip.state === 'playing' && !clip.nextPlayback,
      )
      for (const clip of playingClips) {
        prepareNextPlayback(clip)
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
  })

  function destroy(): void {
    renderLoop.stop()

    // Remove all clips
    for (const clipId of Object.keys(clips)) {
      removeClip(clipId)
    }

    // Remove all tracks
    for (const trackId of Object.keys(tracks)) {
      removeTrack(trackId)
    }

    // Destroy worker pools
    videoWorkerPool.destroy()
    audioWorkerPool.destroy()

    compositor.destroy()
  }

  // Start render loop
  renderLoop.start()

  return {
    // Canvas
    canvas: compositor.canvas,
    compositor,
    clock,
    timeline,
    maxDuration,
    destroy,
    stopRenderLoop: () => renderLoop.stop(),
    startRenderLoop: () => renderLoop.start(),
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

      await Promise.all(readyClips.map(clip => clip.playback.seek(startTime)))

      // Start all playbacks
      for (const clip of readyClips) {
        clip.playback.play(startTime)
        setClips(clip.clipId, 'state', 'playing')
      }

      clock.play(startTime)
    },

    pause() {
      if (!clock.isPlaying()) return
      log('pause')

      // Pause all playbacks
      for (const clip of Object.values(clips)) {
        if (clip.state === 'playing') {
          clip.playback.pause()
          setClips(clip.clipId, 'state', 'paused')
        }
      }

      clock.pause()
    },

    async stop(): Promise<void> {
      log('stop')
      clock.stop()

      // Pause and seek all playbacks to 0
      for (const clip of Object.values(clips)) {
        // Clean up nextPlayback if it exists
        if (clip.nextPlayback) {
          clip.nextPlayback.destroy()
          videoWorkerPool.release(clip.nextPlayback.pooledVideoWorker)
          audioWorkerPool.release(clip.nextPlayback.pooledAudioWorker)
          setClips(clip.clipId, 'nextPlayback', null)
          setClips(clip.clipId, 'nextPlaybackReady', false)
        }

        if (clip.state === 'playing') {
          clip.playback.pause()
        }
        if (clip.state !== 'idle' && clip.state !== 'loading') {
          await clip.playback.seek(0)
          setClips(clip.clipId, 'state', 'ready')
        }
      }
    },

    async seek(time: number): Promise<void> {
      log('seek', { time })
      const wasPlaying = clock.isPlaying()

      if (wasPlaying) {
        clock.pause()
        // Pause all playbacks
        for (const clip of Object.values(clips)) {
          if (clip.state === 'playing') {
            clip.playback.pause()
            setClips(clip.clipId, 'state', 'paused')
          }
        }
      }

      // Seek all clips in parallel
      await Promise.all(
        Array.from(Object.values(clips))
          .filter(clip => clip.state !== 'idle' && clip.state !== 'loading')
          .map(clip => clip.playback.seek(time)),
      )

      clock.seek(time)

      if (wasPlaying) {
        // Resume playback
        for (const clip of Object.values(clips)) {
          if (clip.state === 'paused') {
            clip.playback.play(time)
            setClips(clip.clipId, 'state', 'playing')
          }
        }
        clock.play(time)
      }
    },

    setLoop(enabled: boolean) {
      clock.setLoop(enabled)

      // Clean up any pending nextPlaybacks when looping is disabled
      if (!enabled) {
        for (const clip of Object.values(clips)) {
          if (clip.nextPlayback) {
            log('setLoop: cleaning up nextPlayback', { clipId: clip.clipId })
            clip.nextPlayback.destroy()
            videoWorkerPool.release(clip.nextPlayback.pooledVideoWorker)
            audioWorkerPool.release(clip.nextPlayback.pooledAudioWorker)
            setClips(clip.clipId, 'nextPlayback', null)
            setClips(clip.clipId, 'nextPlaybackReady', false)
          }
        }
      }
    },

    async loadClip(trackId: string, clipId: string): Promise<string> {
      log('loadClip', { trackId, clipId })

      // Ensure track exists (for audio routing)
      getOrCreateTrack(trackId)

      // Get or create clip entry
      const clip = getOrCreateClip(clipId, trackId)
      setClips(clipId, 'state', 'loading')

      // Load from OPFS (workers read the file directly)
      const { duration } = await clip.playback.load(clipId)

      setClips(clipId, 'duration', duration)
      setClips(clipId, 'state', 'ready')

      // Seek to current time (or 0) to show initial frame
      const currentTime = clock.time()
      await clip.playback.seek(currentTime)

      log('loadClip complete', { clipId, duration })
      return clipId
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

    async getClipFrameAtTime(clipId: string, time: number): Promise<VideoFrame | null> {
      const clip = clips[clipId]
      if (!clip || clip.state === 'idle' || clip.state === 'loading') {
        console.log('THIS HAPPENS!!!')
        return null
      }
      return clip.playback.getVideoFrameAtTime(time)
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
      // Reset playback perf too
      for (const clip of Object.values(clips)) {
        clip.playback.resetPerf()
      }
    },
    async getAllPerf() {
      const workerStats: Record<string, Record<string, any>> = {}

      // Collect from all playbacks (keyed by clipId)
      await Promise.all(
        Object.entries(clips).map(async ([clipId, clip]) => {
          try {
            workerStats[clipId] = await clip.playback.getPerf()
          } catch {
            // Playback might not be ready
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
