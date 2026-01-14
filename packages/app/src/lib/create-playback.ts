/**
 * Orchestrated Playback - coordinates video and audio workers in lockstep
 *
 * This module provides a unified playback interface that:
 * - Manages separate video and audio workers
 * - Keeps them synchronized via shared timing
 * - Routes audio to the AudioScheduler for sample-accurate playback
 * - Routes video frames to the compositor
 */

import type { RPC } from '@bigmistqke/rpc/messenger'
import type { AudioTrackInfo, VideoTrackInfo } from '@eddy/codecs'
import { createAudioScheduler, type AudioScheduler } from '@eddy/playback'
import { debug } from '@eddy/utils'
import type { SchedulerBuffer } from '~/lib/scheduler'
import type { PooledWorker } from '~/lib/worker-pool'
import type { AudioPlaybackWorkerMethods } from '~/workers/playback.audio.worker'
import type { VideoPlaybackWorkerMethods } from '~/workers/playback.video.worker'

const log = debug('create-playback', false)

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

  /** Load media from ArrayBuffer */
  load(buffer: ArrayBuffer): Promise<MediaInfo>

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
/*                               Create Playback                                  */
/*                                                                                */
/**********************************************************************************/

/**
 * Create an orchestrated playback instance that coordinates video and audio workers.
 * Workers are provided via pools - caller is responsible for releasing them.
 */
export function createPlayback(config: PlaybackConfig): Playback {
  const { videoWorker: pooledVideoWorker, audioWorker: pooledAudioWorker } = config
  log('createPlayback', { hasSchedulerBuffer: !!config.schedulerBuffer })

  // State
  let state: PlaybackState = 'idle'
  let duration = 0
  let hasVideo = false
  let hasAudio = false

  // Get RPC interfaces from pooled workers
  const videoWorker = pooledVideoWorker.rpc
  const audioWorker = pooledAudioWorker.rpc

  // Set scheduler buffer if provided
  if (config.schedulerBuffer) {
    videoWorker.setSchedulerBuffer(config.schedulerBuffer)
  }

  // Audio scheduler (created after we know audio sample rate)
  let audioScheduler: AudioScheduler | null = null

  return {
    get state() {
      return state
    },

    get duration() {
      return duration
    },

    get hasVideo() {
      return hasVideo
    },

    get hasAudio() {
      return hasAudio
    },

    get pooledVideoWorker() {
      return pooledVideoWorker
    },

    get pooledAudioWorker() {
      return pooledAudioWorker
    },

    get audioScheduler() {
      return audioScheduler
    },

    async load(buffer) {
      log('load', { size: buffer.byteLength })
      state = 'loading'

      // Load into both workers in parallel
      const [videoResult, audioResult] = await Promise.all([
        videoWorker.load(buffer),
        audioWorker.load(buffer),
      ])

      hasVideo = !!videoResult.videoTrack
      hasAudio = !!audioResult.audioTrack
      duration = Math.max(videoResult.duration, audioResult.duration)

      log('load complete', {
        hasVideo,
        hasAudio,
        duration,
        videoCodec: videoResult.videoTrack?.codec,
        audioCodec: audioResult.audioTrack?.codec,
      })

      // Setup audio scheduler if we have audio
      if (hasAudio && audioResult.audioTrack) {
        const sampleRate = audioResult.audioTrack.sampleRate
        const channels = audioResult.audioTrack.channelCount

        // Create audio scheduler (creates ring buffer internally)
        audioScheduler = await createAudioScheduler({
          sampleRate,
          channels,
          destination: config.audioDestination,
        })

        // Pass ring buffer SharedArrayBuffers and target sample rate to audio worker
        // Worker writes decoded samples directly to ring buffer (lock-free)
        const contextSampleRate = audioScheduler.audioContext.sampleRate
        audioWorker.setRingBuffer(audioScheduler.sampleBuffer, audioScheduler.controlBuffer, contextSampleRate)

        log('audio routing setup via SharedArrayBuffer ring buffer', {
          sourceSampleRate: sampleRate,
          contextSampleRate,
          channels,
        })
      }

      state = 'ready'

      return {
        duration,
        videoTrack: videoResult.videoTrack,
        audioTrack: audioResult.audioTrack,
      }
    },

    play(startTime, playbackSpeed = 1) {
      log('play', { startTime, playbackSpeed, hasVideo, hasAudio })

      state = 'playing'

      // Start both workers in lockstep
      if (hasVideo) {
        videoWorker.play(startTime, playbackSpeed)
      }
      if (hasAudio) {
        audioWorker.play(startTime, playbackSpeed)
        audioScheduler?.play(startTime)
      }
    },

    pause() {
      log('pause')

      state = 'paused'

      // Pause both workers
      if (hasVideo) {
        videoWorker.pause()
      }
      if (hasAudio) {
        audioWorker.pause()
        audioScheduler?.pause()
      }
    },

    async seek(time) {
      log('seek', { time })
      const wasPlaying = state === 'playing'

      state = 'seeking'

      // Pause if playing
      if (wasPlaying) {
        if (hasVideo) videoWorker.pause()
        if (hasAudio) {
          audioWorker.pause()
          audioScheduler?.pause()
        }
      }

      // Seek both workers in parallel
      await Promise.all([
        hasVideo ? videoWorker.seek(time) : Promise.resolve(),
        hasAudio ? audioWorker.seek(time) : Promise.resolve(),
      ])

      // Seek audio scheduler
      if (hasAudio) {
        audioScheduler?.seek(time)
      }

      // Resume if was playing
      if (wasPlaying) {
        state = 'playing'
        if (hasVideo) videoWorker.play(time)
        if (hasAudio) {
          audioWorker.play(time)
          audioScheduler?.play(time)
        }
      } else {
        state = 'paused'
      }
    },

    async getVideoFrameAtTime(time) {
      if (!hasVideo) return null
      return videoWorker.getFrameAtTime(time)
    },

    async getAudioAtTime(time) {
      if (!hasAudio) return null
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
      audioScheduler?.stop()
      audioScheduler?.destroy()
      audioScheduler = null

      // Note: Workers are pooled - caller is responsible for releasing them
      // We don't terminate them here

      state = 'idle'
    },
  }
}
