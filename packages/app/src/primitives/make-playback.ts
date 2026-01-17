/**
 * MakePlayback
 *
 * Orchestrated Playback - coordinates video and audio workers in lockstep.
 * Uses a state machine with discriminated unions to prevent impossible states.
 *
 * This module provides a unified playback interface that:
 * - Manages separate video and audio workers
 * - Keeps them synchronized via shared timing
 * - Routes audio to the AudioScheduler for sample-accurate playback
 * - Routes video frames to the compositor
 */

import type { RPC } from '@bigmistqke/rpc/messenger'
import { makeAudioScheduler, type AudioScheduler } from '@eddy/audio'
import type { AudioTrackInfo, VideoTrackInfo } from '@eddy/media'
import { debug } from '@eddy/utils'
import type { SchedulerBuffer } from '~/primitives/make-scheduler'
import type { PooledWorker } from '~/primitives/make-worker-pool'
import type { AudioPlaybackWorkerMethods } from '~/workers/playback.audio.worker'
import type { VideoPlaybackWorkerMethods } from '~/workers/playback.video.worker'

const log = debug('make-playback', false)

export type VideoWorkerRPC = RPC<VideoPlaybackWorkerMethods>
export type AudioWorkerRPC = RPC<AudioPlaybackWorkerMethods>

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

/** Combined playback state */
export type PlaybackState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'seeking'

/** Playback configuration */
export interface PlaybackConfig {
  /** Pooled video worker (if not provided, playback cannot function) */
  videoWorker: PooledWorker<VideoWorkerRPC>
  /** Pooled audio worker (if not provided, playback cannot function) */
  audioWorker: PooledWorker<AudioWorkerRPC>
  /** Scheduler buffer for cross-worker coordination */
  schedulerBuffer?: SchedulerBuffer
  /** Audio destination node (for connecting to effects chain) */
  audioDestination?: AudioNode
}

/** Media info returned after loading */
export interface MediaInfo {
  duration: number
  videoTrack: VideoTrackInfo | null
  audioTrack: AudioTrackInfo | null
}

/** Loaded resources (available in ready/playing/paused/seeking states) */
interface LoadedResources {
  duration: number
  hasVideo: boolean
  hasAudio: boolean
  audioScheduler: AudioScheduler | null
}

/** State machine types */
type PlaybackStateIdle = { type: 'idle' }
type PlaybackStateLoading = { type: 'loading' }
type PlaybackStateReady = { type: 'ready' } & LoadedResources
type PlaybackStatePlaying = { type: 'playing' } & LoadedResources
type PlaybackStatePaused = { type: 'paused' } & LoadedResources
type PlaybackStateSeeking = { type: 'seeking'; wasPlaying: boolean } & LoadedResources

type PlaybackStateMachine =
  | PlaybackStateIdle
  | PlaybackStateLoading
  | PlaybackStateReady
  | PlaybackStatePlaying
  | PlaybackStatePaused
  | PlaybackStateSeeking

/**
 * Orchestrated playback interface for a single media clip.
 * Coordinates video and audio workers in lockstep.
 */
export interface Playback {
  /** Current playback state */
  readonly state: PlaybackState
  /** Media duration in seconds */
  readonly duration: number
  /** Whether playback has video */
  readonly hasVideo: boolean
  /** Whether playback has audio */
  readonly hasAudio: boolean
  /** The pooled video worker (for compositor connection and pool release) */
  readonly pooledVideoWorker: PooledWorker<VideoWorkerRPC>
  /** The pooled audio worker (for pool release) */
  readonly pooledAudioWorker: PooledWorker<AudioWorkerRPC>
  /** The audio scheduler (for routing to audio pipeline) */
  readonly audioScheduler: AudioScheduler | null

  /** Load media from OPFS by clipId */
  load(clipId: string): Promise<MediaInfo>

  /** Start playback from time at speed */
  play(startTime: number, playbackSpeed?: number): void

  /** Pause playback */
  pause(): void

  /** Seek to time */
  seek(time: number): Promise<void>

  /** Get video frame at specific time (for export) */
  getVideoFrameAtTime(time: number): Promise<VideoFrame | null>

  /** Get audio at specific time (for export) */
  getAudioAtTime(time: number): Promise<AudioData | null>

  /** Get combined performance stats */
  getPerf(): Promise<{
    video: Record<string, any>
    audio: Record<string, any>
  }>

  /** Reset performance stats */
  resetPerf(): void

  /** Clean up resources (does NOT release workers - caller manages pool) */
  destroy(): void
}

/**********************************************************************************/
/*                                                                                */
/*                                     Utils                                      */
/*                                                                                */
/**********************************************************************************/

/** Check if state has loaded resources */
function isLoaded(
  state: PlaybackStateMachine,
): state is PlaybackStateReady | PlaybackStatePlaying | PlaybackStatePaused | PlaybackStateSeeking {
  return (
    state.type === 'ready' ||
    state.type === 'playing' ||
    state.type === 'paused' ||
    state.type === 'seeking'
  )
}

/**********************************************************************************/
/*                                                                                */
/*                               Create Playback                                  */
/*                                                                                */
/**********************************************************************************/

function transitionToPlaying(loadedState: LoadedResources): PlaybackStatePlaying {
  return { type: 'playing', ...loadedState }
}

function transitionToPaused(loadedState: LoadedResources): PlaybackStatePaused {
  return { type: 'paused', ...loadedState }
}

function transitionToSeeking(
  loadedState: LoadedResources,
  wasPlaying: boolean,
): PlaybackStateSeeking {
  return { type: 'seeking', wasPlaying, ...loadedState }
}

/**
 * Create an orchestrated playback instance that coordinates video and audio workers.
 * Workers are provided via pools - caller is responsible for releasing them.
 */
export function makePlayback(config: PlaybackConfig): Playback {
  const { videoWorker: pooledVideoWorker, audioWorker: pooledAudioWorker } = config
  log('makePlayback', { hasSchedulerBuffer: !!config.schedulerBuffer })

  let state: PlaybackStateMachine = { type: 'idle' }

  // Get RPC interfaces from pooled workers
  const videoWorker = pooledVideoWorker.rpc
  const audioWorker = pooledAudioWorker.rpc

  // Set scheduler buffer if provided
  if (config.schedulerBuffer) {
    videoWorker.setSchedulerBuffer(config.schedulerBuffer)
  }

  return {
    get state() {
      return state.type
    },

    get duration() {
      return isLoaded(state) ? state.duration : 0
    },

    get hasVideo() {
      return isLoaded(state) ? state.hasVideo : false
    },

    get hasAudio() {
      return isLoaded(state) ? state.hasAudio : false
    },

    get pooledVideoWorker() {
      return pooledVideoWorker
    },

    get pooledAudioWorker() {
      return pooledAudioWorker
    },

    get audioScheduler() {
      return isLoaded(state) ? state.audioScheduler : null
    },

    async load(clipId) {
      log('load', { clipId })
      state = { type: 'loading' }

      // Load into both workers in parallel (they read from OPFS)
      const [videoResult, audioResult] = await Promise.all([
        videoWorker.load(clipId),
        audioWorker.load(clipId),
      ])

      const hasVideo = !!videoResult.videoTrack
      const hasAudio = !!audioResult.audioTrack
      const duration = Math.max(videoResult.duration, audioResult.duration)

      log('load complete', {
        hasVideo,
        hasAudio,
        duration,
        videoCodec: videoResult.videoTrack?.codec,
        audioCodec: audioResult.audioTrack?.codec,
      })

      // Setup audio scheduler if we have audio
      let audioScheduler: AudioScheduler | null = null
      if (hasAudio && audioResult.audioTrack) {
        const sampleRate = audioResult.audioTrack.sampleRate
        const channels = audioResult.audioTrack.channelCount

        // Create audio scheduler (creates ring buffer internally)
        audioScheduler = await makeAudioScheduler({
          sampleRate,
          channels,
          destination: config.audioDestination,
        })

        // Pass ring buffer SharedArrayBuffers and target sample rate to audio worker
        // Worker writes decoded samples directly to ring buffer (lock-free)
        const contextSampleRate = audioScheduler.audioContext.sampleRate
        audioWorker.setRingBuffer(
          audioScheduler.sampleBuffer,
          audioScheduler.controlBuffer,
          contextSampleRate,
        )

        log('audio routing setup via SharedArrayBuffer ring buffer', {
          sourceSampleRate: sampleRate,
          contextSampleRate,
          channels,
        })
      }

      state = {
        type: 'ready',
        duration,
        hasVideo,
        hasAudio,
        audioScheduler,
      }

      return {
        duration,
        videoTrack: videoResult.videoTrack,
        audioTrack: audioResult.audioTrack,
      }
    },

    play(startTime, playbackSpeed = 1) {
      if (!isLoaded(state)) {
        log('play: not loaded')
        return
      }

      log('play', { startTime, playbackSpeed, hasVideo: state.hasVideo, hasAudio: state.hasAudio })

      // Start both workers in lockstep
      if (state.hasVideo) {
        videoWorker.play(startTime, playbackSpeed)
      }
      if (state.hasAudio) {
        audioWorker.play(startTime, playbackSpeed)
        state.audioScheduler?.play(startTime)
      }

      state = transitionToPlaying(state)
    },

    pause() {
      if (!isLoaded(state)) {
        log('pause: not loaded')
        return
      }

      log('pause')

      // Pause both workers
      if (state.hasVideo) {
        videoWorker.pause()
      }
      if (state.hasAudio) {
        audioWorker.pause()
        state.audioScheduler?.pause()
      }

      state = transitionToPaused(state)
    },

    async seek(time) {
      if (!isLoaded(state)) {
        log('seek: not loaded')
        return
      }

      log('seek', { time })
      const wasPlaying = state.type === 'playing'

      // Pause if playing
      if (wasPlaying) {
        if (state.hasVideo) videoWorker.pause()
        if (state.hasAudio) {
          audioWorker.pause()
          state.audioScheduler?.pause()
        }
      }

      state = transitionToSeeking(state, wasPlaying)

      // Seek both workers in parallel
      await Promise.all([
        state.hasVideo ? videoWorker.seek(time) : Promise.resolve(),
        state.hasAudio ? audioWorker.seek(time) : Promise.resolve(),
      ])

      // Seek audio scheduler
      if (state.hasAudio) {
        state.audioScheduler?.seek(time)
      }

      // Resume if was playing
      if (wasPlaying) {
        if (state.hasVideo) videoWorker.play(time)
        if (state.hasAudio) {
          audioWorker.play(time)
          state.audioScheduler?.play(time)
        }
        state = transitionToPlaying(state)
      } else {
        state = transitionToPaused(state)
      }
    },

    async getVideoFrameAtTime(time) {
      if (!isLoaded(state) || !state.hasVideo) return null
      return videoWorker.getFrameAtTime(time)
    },

    async getAudioAtTime(time) {
      if (!isLoaded(state) || !state.hasAudio) return null
      return audioWorker.getAudioAtTime(time)
    },

    async getPerf() {
      const [video, audio] = await Promise.all([videoWorker.getPerf(), audioWorker.getPerf()])
      return { video, audio }
    },

    resetPerf() {
      videoWorker.resetPerf()
      audioWorker.resetPerf()
    },

    destroy() {
      log('destroy')

      // Stop and destroy audio scheduler
      if (isLoaded(state) && state.audioScheduler) {
        state.audioScheduler.stop()
        state.audioScheduler.destroy()
      }

      // Note: Workers are pooled - caller is responsible for releasing them
      // We don't terminate them here

      state = { type: 'idle' }
    },
  }
}
