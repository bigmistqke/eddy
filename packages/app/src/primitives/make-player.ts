import { rpc, transfer, type RPC } from '@bigmistqke/rpc/messenger'
import { makeAudioBus, type AudioBus, type AudioBusOutput } from '@eddy/audio'
import type { AudioPipeline, Group, Project, StaticValue } from '@eddy/lexicons'
import { createClock, type Clock } from '@eddy/solid'
import { compileLayoutTimeline, type CompiledTimeline } from '@eddy/timeline'
import { debug, makeLoop, makeMonitor } from '@eddy/utils'
import { createEffect, createMemo, createSignal, on, type Accessor } from 'solid-js'
import { createStore } from 'solid-js/store'
import { PREVIEW_CLIP_ID } from '~/constants'
import { makeAheadScheduler, SCHEDULE_AHEAD } from '~/primitives/make-ahead-scheduler'
import {
  makePlayback,
  type AudioWorkerRPC,
  type Playback,
  type VideoWorkerRPC,
} from '~/primitives/make-playback'
import type { SchedulerBuffer } from '~/primitives/make-scheduler'
import { makeWorkerPool } from '~/primitives/make-worker-pool'
import type { CompositorMethods, CompositorWorkerMethods } from '~/workers/compositor.worker'
import CompositorWorker from '~/workers/compositor.worker?worker'
import type { AudioPlaybackWorkerMethods } from '~/workers/playback.audio.worker'
import AudioPlaybackWorker from '~/workers/playback.audio.worker?worker'
import type { VideoPlaybackWorkerMethods } from '~/workers/playback.video.worker'
import VideoPlaybackWorker from '~/workers/playback.video.worker?worker'

const log = debug('make-player', false)
const monitor = makeMonitor<
  'renderLoop',
  'frames-expected' | 'frames-rendered' | 'frames-dropped' | 'frames-stale'
>()
const counters: Array<{
  'frames-expected': number
  'frames-rendered': number
  'frames-dropped': number
  'frames-stale': number
}> = []

// Expose perf stats globally for console debugging
if (typeof window !== 'undefined') {
  ;(window as any).eddy = { monitor }
}

/**********************************************************************************/
/*                                                                                */
/*                                      Types                                     */
/*                                                                                */
/**********************************************************************************/

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
  /** Set master volume (root group's audio bus) */
  setMasterVolume: (value: number) => void
  /** Get master volume (root group's audio bus) */
  getMasterVolume: () => number
  /** Set master pan (root group's audio bus) */
  setMasterPan: (value: number) => void
  /** Route master output through MediaStream (for recording) */
  useMasterMediaStreamOutput: () => void
  /** Route master output directly to destination */
  useMasterDirectOutput: () => void
  /** Clean up all resources */
  destroy: () => void
  /** Stop the render loop (for export) */
  stopRenderLoop: () => void
  /** Start the render loop */
  startRenderLoop: () => void
}

export type Compositor = Omit<RPC<CompositorMethods>, 'setPreviewStream'> & {
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
  /** Get track audio pipeline by trackId */
  getAudioPipeline: (trackId: string) => AudioBus | undefined
  /** Get group audio pipeline by groupId */
  getGroupAudioPipeline: (groupId: string) => AudioBus | undefined
  /** Performance logging */
  logMonitor: () => void
  resetMonitor: () => void
  /** Get all perf stats (main thread + workers) */
  getAllPerf: () => Promise<{
    main: Record<string, any>
    workers: Record<string, Record<string, any>>
  }>
}

export interface CreatePlayerOptions {
  canvas: HTMLCanvasElement
  width: number
  height: number
  project: Accessor<Project>
  schedulerBuffer: SchedulerBuffer
}

/** Group entry for audio routing */
interface GroupEntry {
  groupId: string
  audioPipeline: AudioBus
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
}

/**********************************************************************************/
/*                                                                                */
/*                                     Utils                                      */
/*                                                                                */
/**********************************************************************************/

/**
 * Resolve a StaticValue to a number (0-100 scale from lexicon -> 0-1 for audio).
 */
function resolveStaticValue(value: StaticValue | undefined, defaultValue: number): number {
  if (!value) return defaultValue
  return value.value / 100
}

/**
 * Inject a preview clip into a track, replacing its existing clips.
 * Used as middleware before compilation when a track is in preview mode.
 */
function injectPreviewClip(project: Project, previewTrackId: string): Project {
  return {
    ...project,
    tracks: project.tracks.map(track => {
      if (track.id !== previewTrackId) return track
      return {
        ...track,
        clips: [
          {
            id: PREVIEW_CLIP_ID,
            offset: 0,
            duration: Number.MAX_SAFE_INTEGER, // Effectively infinite
          },
        ],
      }
    }),
  }
}

/**
 * Inject preview clips for multiple tracks.
 */
function injectPreviewClips(project: Project, previewTrackIds: Set<string>): Project {
  if (previewTrackIds.size === 0) return project

  let result = project
  for (const trackId of previewTrackIds) {
    result = injectPreviewClip(result, trackId)
  }
  return result
}

/**********************************************************************************/
/*                                                                                */
/*                                  Make Player                                   */
/*                                                                                */
/**********************************************************************************/

/**
 * Create a player that manages compositor, playback workers, and audio pipelines.
 * Uses direct worker-to-worker frame transfer for video.
 */
export async function makePlayer(options: CreatePlayerOptions): Promise<Player> {
  const { canvas: canvasElement, width, height, project, schedulerBuffer } = options
  log('makePlayer', { width, height, schedulerBuffer })

  // Set canvas size and transfer to worker
  canvasElement.width = width
  canvasElement.height = height
  const offscreen = canvasElement.transferControlToOffscreen()

  // Create compositor worker and initialize with canvas
  const compositorWorker = new CompositorWorker()
  const compositorWorkerRpc = rpc<CompositorWorkerMethods>(compositorWorker)
  const compositorRpc = await compositorWorkerRpc.init(transfer(offscreen), width, height)

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
    setEffectValue: compositorRpc.setEffectValue,

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
  const videoWorkerPool = makeWorkerPool<VideoWorkerRPC>({
    create: () => new VideoPlaybackWorker(),
    wrap: worker => rpc<VideoPlaybackWorkerMethods>(worker),
    maxSize: 8,
  })

  const audioWorkerPool = makeWorkerPool<AudioWorkerRPC>({
    create: () => new AudioPlaybackWorker(),
    wrap: worker => rpc<AudioPlaybackWorkerMethods>(worker),
    maxSize: 8,
  })

  // Group entries - keyed by groupId (audio routing)
  const [groups, setGroups] = createStore<Record<string, GroupEntry>>({})

  // Track entries - keyed by trackId (audio routing only)
  const [tracks, setTracks] = createStore<Record<string, TrackEntry>>({})

  // Clip entries - keyed by clipId (playback workers)
  const [clips, setClips] = createStore<Record<string, ClipEntry>>({})

  /** Build a map from member ID (track or group) to parent group */
  function buildParentMap(): Map<string, Group> {
    const parentMap = new Map<string, Group>()
    for (const group of project().groups) {
      for (const member of group.members) {
        if ('id' in member && member.id) {
          parentMap.set(member.id, group)
        }
      }
    }
    return parentMap
  }

  /** Get the root group from project */
  function getRootGroup(): Group | undefined {
    const proj = project()
    if (proj.rootGroup) {
      return proj.groups.find(g => g.id === proj.rootGroup)
    }
    return proj.groups[0]
  }

  /**
   * Resolve pipeline outputs to AudioBusOutputs.
   * If outputs are specified in the pipeline, resolve refs to actual AudioNodes.
   * Falls back to hierarchical destination if no outputs or ref not found.
   */
  function resolveAudioOutputs(
    pipeline: AudioPipeline | undefined,
    hierarchicalDestination: AudioNode | undefined,
  ): AudioBusOutput[] | undefined {
    const outputs = pipeline?.outputs
    if (!outputs || outputs.length === 0) {
      return undefined // Use single destination mode
    }

    const resolved: AudioBusOutput[] = []
    for (const output of outputs) {
      // Try to resolve the ref to a group or track
      const targetGroup = groups[output.ref]
      const targetTrack = tracks[output.ref]

      let destination: AudioNode
      if (targetGroup) {
        destination = targetGroup.audioPipeline.effectChain.input
      } else if (targetTrack) {
        destination = targetTrack.audioPipeline.effectChain.input
      } else if (hierarchicalDestination) {
        // Fallback to hierarchical destination if ref not resolved
        log('output ref not found, using hierarchical destination', { ref: output.ref })
        destination = hierarchicalDestination
      } else {
        // Skip this output if no destination available
        continue
      }

      resolved.push({
        destination,
        amount: resolveStaticValue(output.amount, 1),
      })
    }

    return resolved.length > 0 ? resolved : undefined
  }

  /** Get or create a group entry (audio pipeline) */
  function getOrCreateGroup(groupId: string): GroupEntry {
    const group = groups[groupId]

    if (group) {
      return group
    }

    log('creating group entry', { groupId })

    // Look up group's audio pipeline from project
    const projectGroup = project().groups.find(g => g.id === groupId)
    const pipeline = projectGroup?.audioPipeline
    const effects = pipeline?.effects ?? []

    // Find parent group to route to (or master if root)
    const parentMap = buildParentMap()
    const parentGroup = parentMap.get(groupId)

    let hierarchicalDestination: AudioNode | undefined
    if (parentGroup && parentGroup.id !== groupId) {
      // Route to parent group's audio bus
      const parentEntry = getOrCreateGroup(parentGroup.id)
      hierarchicalDestination = parentEntry.audioPipeline.effectChain.input
    }
    // If no parent (root group), destination is undefined → routes to master

    // Resolve outputs if specified, otherwise use hierarchical destination
    const outputs = resolveAudioOutputs(pipeline, hierarchicalDestination)

    const newGroup: GroupEntry = {
      groupId,
      audioPipeline: makeAudioBus({
        effects,
        destination: outputs ? undefined : hierarchicalDestination,
        outputs,
      }),
    }
    setGroups(groupId, newGroup)

    return newGroup
  }

  // Ahead scheduler for pre-buffering playbacks (used for looping)
  const aheadScheduler = makeAheadScheduler({
    videoWorkerPool,
    audioWorkerPool,
    schedulerBuffer,
    getAudioDestination: trackId => tracks[trackId]?.audioPipeline.effectChain.input,
  })

  /** Get or create a track entry (audio pipeline only) */
  function getOrCreateTrack(trackId: string): TrackEntry {
    const track = tracks[trackId]

    if (track) {
      return track
    }

    log('creating track entry', { trackId })

    // Look up track's audio pipeline from project
    const projectTrack = project().tracks.find(t => t.id === trackId)
    const pipeline = projectTrack?.audioPipeline
    const effects = pipeline?.effects ?? []

    // Find parent group to route to
    const parentMap = buildParentMap()
    const parentGroup = parentMap.get(trackId)

    let hierarchicalDestination: AudioNode | undefined
    if (parentGroup) {
      // Route to parent group's audio bus
      const groupEntry = getOrCreateGroup(parentGroup.id)
      hierarchicalDestination = groupEntry.audioPipeline.effectChain.input
    }
    // If no parent group, destination is undefined → routes to master

    // Resolve outputs if specified, otherwise use hierarchical destination
    const outputs = resolveAudioOutputs(pipeline, hierarchicalDestination)

    const newTrack: TrackEntry = {
      trackId,
      audioPipeline: makeAudioBus({
        effects,
        destination: outputs ? undefined : hierarchicalDestination,
        outputs,
      }),
    }
    setTracks(trackId, newTrack)

    return newTrack
  }

  /** Get or create a clip entry (orchestrated playback) */
  async function getOrCreateClip(clipId: string, trackId: string): Promise<ClipEntry> {
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
    const playback = makePlayback({
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

    // Cancel any scheduled playback for this clip
    aheadScheduler.cancel(clipId)

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

  /** Remove a group entry */
  function removeGroup(groupId: string): void {
    const group = groups[groupId]

    if (!group) return

    log('removing group entry', { groupId })

    // Disconnect audio pipeline
    group.audioPipeline.disconnect()

    setGroups(groupId, undefined!)
  }

  // Sync timeline with compositor when project changes
  createEffect(
    on(timeline, currentTimeline => {
      compositor.setTimeline(currentTimeline)
    }),
  )

  /**
   * Activate a scheduled playback for a clip.
   * Swaps the current playback with the scheduled one, connects to compositor, and plays.
   */
  function activateScheduledPlayback(clip: ClipEntry, mediaTime: number): void {
    const newPlayback = aheadScheduler.activate(clip.clipId)

    if (!newPlayback) {
      log('activateScheduledPlayback: not ready, falling back to seek', { clipId: clip.clipId })
      // Fallback: seek current playback
      clip.playback.seek(mediaTime).then(() => {
        clip.playback.play(mediaTime)
      })
      return
    }

    log('activateScheduledPlayback: swapping playbacks', { clipId: clip.clipId, mediaTime })

    const oldPlayback = clip.playback

    // Connect new video worker to compositor
    const channel = new MessageChannel()
    compositorRpc.connectPlaybackWorker(clip.clipId, transfer(channel.port1))
    newPlayback.pooledVideoWorker.rpc.connectToCompositor(clip.clipId, transfer(channel.port2))

    // Start playing - frames are already buffered
    newPlayback.play(mediaTime)

    setClips(clip.clipId, {
      playback: newPlayback,
    })

    // Destroy old playback and release workers back to pools
    oldPlayback.destroy()
    videoWorkerPool.release(oldPlayback.pooledVideoWorker)
    audioWorkerPool.release(oldPlayback.pooledAudioWorker)
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

  const renderLoop = makeLoop(
    monitor('renderLoop', () => {
      const time = clock.tick()
      const playing = clock.isPlaying()
      const looping = clock.loop()
      const duration = maxDuration()

      // Detect loop reset (clock jumped backward while playing)
      if (playing && time < prevTime) {
        log('loop reset detected', { prevTime, time })
        // Activate scheduled playbacks for all playing clips
        const playingClips = Object.values(clips).filter(clip => clip.state === 'playing')
        for (const clip of playingClips) {
          activateScheduledPlayback(clip, 0)
        }
      }
      prevTime = time

      // Schedule playbacks ahead when playing
      if (playing && duration > 0) {
        // Calculate schedule-ahead time (with modulo for looping)
        const scheduleTime = looping ? (time + SCHEDULE_AHEAD) % duration : time + SCHEDULE_AHEAD

        // Only schedule if we're approaching a transition point
        // For looping: schedule when near the end (scheduleTime wraps to start)
        const nearLoopEnd = looping && time + SCHEDULE_AHEAD >= duration

        if (nearLoopEnd) {
          const playingClips = Object.values(clips).filter(
            clip => clip.state === 'playing' && !aheadScheduler.hasScheduled(clip.clipId),
          )
          for (const clip of playingClips) {
            aheadScheduler.schedule(clip.clipId, clip.trackId, scheduleTime)
          }
        }
      }

      // Render compositor at current time and track frame availability
      compositor.render(time).then(stats => {
        // Track dropped frames (only when playing and expecting frames)
        if (playing && stats.expected > 0) {
          counters.push({
            'frames-expected': stats.expected,
            'frames-rendered': stats.rendered,
            'frames-dropped': stats.dropped,
            'frames-stale': stats.stale,
          })
        }
      })
    }),
  )

  function destroy(): void {
    renderLoop.stop()

    // Cancel all scheduled playbacks
    aheadScheduler.destroy()

    // Remove all clips
    for (const clipId of Object.keys(clips)) {
      removeClip(clipId)
    }

    // Remove all tracks
    for (const trackId of Object.keys(tracks)) {
      removeTrack(trackId)
    }

    // Remove all groups
    for (const groupId of Object.keys(groups)) {
      removeGroup(groupId)
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

      // Cancel all scheduled playbacks
      aheadScheduler.cancelAll()

      // Pause and seek all playbacks to 0
      for (const clip of Object.values(clips)) {
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

      // Cancel all scheduled playbacks when looping is disabled
      if (!enabled) {
        aheadScheduler.cancelAll()
      }
    },

    async loadClip(trackId: string, clipId: string): Promise<string> {
      log('loadClip', { trackId, clipId })

      // Ensure track exists (for audio routing)
      getOrCreateTrack(trackId)

      // Get or create clip entry (now async)
      const clip = await getOrCreateClip(clipId, trackId)
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

    setMasterVolume(value: number): void {
      const rootGroup = getRootGroup()
      if (rootGroup) {
        getOrCreateGroup(rootGroup.id).audioPipeline.setVolume(value)
      }
    },

    getMasterVolume(): number {
      const rootGroup = getRootGroup()
      if (rootGroup) {
        return getOrCreateGroup(rootGroup.id).audioPipeline.getVolume()
      }
      return 1
    },

    setMasterPan(value: number): void {
      const rootGroup = getRootGroup()
      if (rootGroup) {
        getOrCreateGroup(rootGroup.id).audioPipeline.setPan(value)
      }
    },

    useMasterMediaStreamOutput(): void {
      const rootGroup = getRootGroup()
      if (rootGroup) {
        getOrCreateGroup(rootGroup.id).audioPipeline.useMediaStreamOutput()
      }
    },

    useMasterDirectOutput(): void {
      const rootGroup = getRootGroup()
      if (rootGroup) {
        getOrCreateGroup(rootGroup.id).audioPipeline.useDirectOutput()
      }
    },

    // Utilities
    getAudioPipeline: (trackId: string) => tracks[trackId]?.audioPipeline,
    getGroupAudioPipeline: (groupId: string) => groups[groupId]?.audioPipeline,
    logMonitor: monitor.log,
    resetMonitor() {
      monitor.reset()
      counters.length = 0
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
        main: { ...monitor.getAllStats(), counters },
        workers: workerStats,
      }
    },
  }
}
