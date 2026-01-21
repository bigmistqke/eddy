/**
 * CreateVideoPlayback
 *
 * Handles demuxing, decoding, and frame buffering for smooth video playback.
 * Uses a state machine with discriminated unions to prevent impossible states.
 */

import type { DemuxedSample, VideoTrackInfo } from '@eddy/media'
import { assertedNotNullish, debug, makeLoop, makeMonitor } from '@eddy/utils'
import {
  ALL_FORMATS,
  EncodedPacketSink,
  Input,
  type EncodedPacket,
  type InputVideoTrack,
  type Source,
} from 'mediabunny'
import { dataToFrame, frameToData, type FrameData } from './frame-utils'
import { makeVideoDecoder, type VideoDecoderHandle } from './make-video-decoder'

const log = debug('playback:create-video-playback', false)

/** Buffer configuration */
const BUFFER_AHEAD_FRAMES = 10
const BUFFER_AHEAD_SECONDS = 1.0
const BUFFER_MAX_FRAMES = 30

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

/** Video playback state */
export type VideoPlaybackState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'seeking'

/** Frame output callback */
export type FrameCallback = (frame: VideoFrame | null) => void

/** Video playback configuration */
export interface VideoPlaybackConfig {
  /** Callback when a new frame should be displayed */
  onFrame?: FrameCallback
  /** External backpressure check - return true to skip delta frames */
  shouldSkipDeltaFrame?: () => boolean
}

/** Preserved decoder state for reuse across loads */
interface PreservedDecoder {
  decoder: VideoDecoderHandle
  config: VideoDecoderConfig
}

/** Loaded resources (available in ready/playing/paused/seeking states) */
interface LoadedResources {
  input: Input
  videoTrack: InputVideoTrack
  videoSink: EncodedPacketSink
  videoConfig: VideoDecoderConfig
  duration: number
  decoder: VideoDecoderHandle
  timing: PlaybackTiming
  frameBuffer: FrameBuffer
}

/** Playback timing interface */
interface PlaybackTiming {
  getCurrentTime(): number
  start(mediaTime: number, playbackSpeed: number): void
  pause(): number
  setSpeed(speed: number): void
  getSpeed(): number
}

/** Frame buffer interface */
interface FrameBuffer {
  insert(frame: FrameData): void
  findAt(timeSeconds: number, strict?: boolean): FrameData | null
  trimBefore(timeSeconds: number, keepPastSeconds?: number): void
  clear(): void
  getRange(): { start: number; end: number }
  getLength(): number
  getAll(): FrameData[]
}

/** State machine types */
type PlaybackStateIdle = { type: 'idle'; preservedDecoder?: PreservedDecoder }
type PlaybackStateLoading = { type: 'loading'; preservedDecoder?: PreservedDecoder }
type PlaybackStateReady = { type: 'ready' } & LoadedResources
type PlaybackStatePlaying = { type: 'playing' } & LoadedResources
type PlaybackStatePaused = { type: 'paused'; pausedAt: number } & LoadedResources
type PlaybackStateSeeking = {
  type: 'seeking'
  targetTime: number
  wasPlaying: boolean
} & LoadedResources

type PlaybackStateMachine =
  | PlaybackStateIdle
  | PlaybackStateLoading
  | PlaybackStateReady
  | PlaybackStatePlaying
  | PlaybackStatePaused
  | PlaybackStateSeeking

/**
 * VideoPlayback handles demuxing, decoding, and frame buffering
 * for smooth video playback. It manages its own internal state and
 * timing, outputting VideoFrames via callback.
 */
export interface VideoPlayback {
  /** Whether playback is active */
  readonly isPlaying: boolean
  /** Video duration in seconds */
  readonly videoDuration: number
  /** Get current buffer range */
  getBufferRange(): { start: number; end: number }
  /** Get performance stats */
  getPerf(): Record<
    string,
    {
      samples: number
      avg: number
      max: number
      min: number
      overThreshold: number
    }
  >
  /** Current playback state */
  getState(): VideoPlaybackState
  /** Load video from source */
  load(source: Source): Promise<{
    duration: number
    videoTrack: VideoTrackInfo | null
  }>
  /** Pause playback */
  pause(): void
  /** Start playback from time at speed */
  play(startTime: number, playbackSpeed?: number): void
  /** Reset performance stats */
  resetPerf(): void
  /** Seek to time (buffers from keyframe) */
  seek(time: number): Promise<void>
  /** Send current frame to compositor (for initial frame on handoff) */
  sendCurrentFrame(): void
  /** Set frame output callback */
  setFrameCallback(callback: FrameCallback | null): void
  /** Get a frame at a specific time (for export). Seeks and returns the frame directly. */
  getFrameAtTime(time: number): Promise<VideoFrame | null>
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

/** Convert packet to sample format */
function packetToSample(packet: EncodedPacket, trackId: number): DemuxedSample {
  return {
    number: 0,
    trackId,
    timestamp: packet.timestamp,
    duration: packet.duration,
    isKeyframe: packet.type === 'key',
    data: packet.data,
    size: packet.data.byteLength,
  }
}

/** Check if two VideoDecoderConfigs are equivalent (can reuse decoder) */
function configsMatch(a: VideoDecoderConfig | null, b: VideoDecoderConfig | null): boolean {
  if (!a || !b) return false
  return a.codec === b.codec && a.codedWidth === b.codedWidth && a.codedHeight === b.codedHeight
}

/**********************************************************************************/
/*                                                                                */
/*                             Create Playback Timing                             */
/*                                                                                */
/**********************************************************************************/

/** Create playback timing manager */
function createPlaybackTiming(): PlaybackTiming {
  let startWallTime = 0
  let startMediaTime = 0
  let speed = 1
  let isRunning = false

  return {
    getCurrentTime(): number {
      if (!isRunning) return startMediaTime
      const elapsed = (performance.now() - startWallTime) / 1000
      return startMediaTime + elapsed * speed
    },

    start(mediaTime: number, playbackSpeed: number): void {
      startMediaTime = mediaTime
      startWallTime = performance.now()
      speed = playbackSpeed
      isRunning = true
    },

    pause(): number {
      const currentTime = this.getCurrentTime()
      startMediaTime = currentTime
      isRunning = false
      return currentTime
    },

    setSpeed(newSpeed: number): void {
      if (isRunning) {
        startMediaTime = this.getCurrentTime()
        startWallTime = performance.now()
      }
      speed = newSpeed
    },

    getSpeed(): number {
      return speed
    },
  }
}

/**********************************************************************************/
/*                                                                                */
/*                              Create Frame Buffer                               */
/*                                                                                */
/**********************************************************************************/

/** Create frame buffer manager */
function createFrameBuffer(maxFrames: number = BUFFER_MAX_FRAMES): FrameBuffer {
  let frames: FrameData[] = []

  return {
    insert(frame: FrameData): void {
      const insertIndex = frames.findIndex(f => f.timestamp > frame.timestamp)
      if (insertIndex === -1) {
        frames.push(frame)
      } else {
        frames.splice(insertIndex, 0, frame)
      }

      while (frames.length > maxFrames) {
        frames.shift()
      }
    },

    findAt(timeSeconds: number, strict = false): FrameData | null {
      if (frames.length === 0) return null

      const timeUs = timeSeconds * 1_000_000
      let best: FrameData | null = null

      for (const frame of frames) {
        if (frame.timestamp <= timeUs) {
          best = frame
        } else {
          break
        }
      }

      // In strict mode (export), don't return future frames - they indicate stale buffer
      // In playback mode, return first frame as fallback to avoid black flicker
      if (!best && !strict) {
        return frames[0]
      }

      return best
    },

    trimBefore(timeSeconds: number, keepPastSeconds = 0.5): void {
      const minTimestamp = (timeSeconds - keepPastSeconds) * 1_000_000

      while (frames.length > 1 && frames[0].timestamp < minTimestamp) {
        frames.shift()
      }
    },

    clear(): void {
      frames = []
    },

    getRange(): { start: number; end: number } {
      if (frames.length === 0) {
        return { start: 0, end: 0 }
      }
      return {
        start: frames[0].timestamp / 1_000_000,
        end: frames[frames.length - 1].timestamp / 1_000_000,
      }
    },

    getLength(): number {
      return frames.length
    },

    getAll(): FrameData[] {
      return frames
    },
  }
}

/**********************************************************************************/
/*                                                                                */
/*                             Create Video Playback                              */
/*                                                                                */
/**********************************************************************************/

function transitionToPlaying(
  loadedState: LoadedResources,
  startTime: number,
  playbackSpeed: number,
): PlaybackStatePlaying {
  loadedState.timing.start(startTime, playbackSpeed)
  return { type: 'playing', ...loadedState }
}

function transitionToPaused(loadedState: LoadedResources): PlaybackStatePaused {
  const pausedAt = loadedState.timing.pause()
  return { type: 'paused', pausedAt, ...loadedState }
}

function transitionToSeeking(
  loadedState: LoadedResources,
  targetTime: number,
  wasPlaying: boolean,
): PlaybackStateSeeking {
  return { type: 'seeking', targetTime, wasPlaying, ...loadedState }
}

/**
 * Create a new video playback engine instance
 */
export function makeVideoPlayback({
  onFrame,
  shouldSkipDeltaFrame,
}: VideoPlaybackConfig = {}): VideoPlayback {
  const monitor = makeMonitor<'demux' | 'decode' | 'transferFrame'>()
  const demux = monitor('demux')
  const decode = monitor('decode', (decoder: VideoDecoderHandle, sample: DemuxedSample) =>
    decoder.decode(sample),
  )

  let state: PlaybackStateMachine = { type: 'idle' }

  let bufferPosition = 0
  let isBuffering = false
  let lastSentTimestamp: number | null = null

  const transferFrame = monitor(
    'transferFrame',
    (frameData: FrameData, callback: FrameCallback) => {
      const frame = dataToFrame(frameData)
      lastSentTimestamp = frameData.timestamp
      callback(frame)
    },
  )

  function sendFrame(time: number): void {
    if (!onFrame || !isLoaded(state)) return

    const frameData = state.frameBuffer.findAt(time)
    if (!frameData) {
      // No frame available - clear if we had one
      if (lastSentTimestamp !== null) {
        lastSentTimestamp = null
        onFrame(null)
      }
      return
    }

    // Skip if same frame
    if (frameData.timestamp === lastSentTimestamp) {
      return
    }

    transferFrame(frameData, onFrame)
  }

  async function bufferAhead(fromTime: number): Promise<void> {
    if (!isLoaded(state)) return
    if (isBuffering) return

    const { videoSink, videoTrack, duration, decoder, frameBuffer } = state

    const targetEnd = Math.min(fromTime + BUFFER_AHEAD_SECONDS, duration)
    if (bufferPosition >= targetEnd) return

    isBuffering = true
    log('bufferAhead', { fromTime, targetEnd, bufferPosition })

    try {
      let packet = await demux(async () => {
        const pkt = await videoSink.getPacket(bufferPosition)
        return pkt ?? (await videoSink.getFirstPacket())
      })

      let decoded = 0
      while (packet && packet.timestamp < targetEnd && decoded < BUFFER_AHEAD_FRAMES) {
        const sample = packetToSample(packet, videoTrack.id)

        const result = await decode(decoder, sample)

        switch (result.type) {
          case 'frame': {
            const data = await frameToData(result.frame, sample)
            frameBuffer.insert(data)
            bufferPosition = sample.timestamp + sample.duration
            decoded++
            break
          }

          case 'skipped':
            log('bufferAhead: frame skipped', { reason: result.reason, pts: sample.timestamp })
            if (result.reason === 'not-ready') {
              log('bufferAhead: decoder not ready, returning to let seekToTime handle it')
              return
            }
            break

          case 'needs-keyframe': {
            log('bufferAhead: decoder needs keyframe', { time: result.time })
            const keyPacket = await videoSink.getKeyPacket(result.time)
            if (keyPacket) {
              log('bufferAhead: found recovery keyframe', {
                keyframePts: keyPacket.timestamp,
                requestedTime: result.time,
              })
              packet = keyPacket
              bufferPosition = keyPacket.timestamp
              continue
            }
            break
          }
        }

        packet = await demux(() => videoSink.getNextPacket(packet!))
      }
    } catch (error) {
      console.error('[playback:engine] bufferAhead error', error)
    } finally {
      isBuffering = false
    }
  }

  async function seekToTime(time: number): Promise<void> {
    if (!isLoaded(state)) return

    log('seekToTime: starting', { time })

    const { videoSink, videoTrack, decoder, frameBuffer, duration } = state

    frameBuffer.clear()
    lastSentTimestamp = null
    isBuffering = false

    decoder.reset()

    log('seekToTime: decoder reset')

    log('seekToTime: getting keyframe packet')
    const keyPacket = await videoSink.getKeyPacket(time)
    bufferPosition = keyPacket?.timestamp ?? 0

    log('seekToTime: got keyframe, decoding to target', { keyframe: bufferPosition, target: time })

    const targetUs = time * 1_000_000
    let packet = keyPacket

    while (packet && bufferPosition < time + BUFFER_AHEAD_SECONDS) {
      const sample = packetToSample(packet, videoTrack.id)
      const maybeResult = decoder.decode(sample)
      const result = maybeResult instanceof Promise ? await maybeResult : maybeResult

      if (result.type === 'frame') {
        const data = await frameToData(result.frame, sample)
        frameBuffer.insert(data)
        bufferPosition = sample.timestamp + sample.duration

        if (data.timestamp >= targetUs) {
          break
        }
      } else if (result.type === 'needs-keyframe') {
        log('seekToTime: decoder needs keyframe, breaking')
        break
      }

      packet = await videoSink.getNextPacket(packet)
    }

    log('seekToTime: done', { framesBuffered: frameBuffer.getLength() })
  }

  const streamLoop = makeLoop(loop => {
    if (!isLoaded(state)) {
      loop.stop()
      return
    }

    const time = state.timing.getCurrentTime()
    const { duration, decoder, frameBuffer } = state

    if (duration > 0 && time >= duration) {
      log('streamLoop: reached end', { time, duration })
      const pausedAt = state.timing.pause()
      state = { ...state, type: 'paused', pausedAt }
      loop.stop()
      return
    }

    if (Math.random() < 0.016) {
      log('streamLoop: status', {
        time,
        bufferLength: frameBuffer.getLength(),
        bufferPosition,
        isBuffering,
        decoderReady: decoder.isReady,
        decoderState: decoder.state,
        lastSentTimestamp,
      })
    }

    sendFrame(time)
    frameBuffer.trimBefore(time)
    bufferAhead(time)
  })

  return {
    get isPlaying() {
      return streamLoop.isRunning
    },

    get videoDuration() {
      return isLoaded(state) ? state.duration : 0
    },

    getState(): VideoPlaybackState {
      return state.type
    },

    setFrameCallback(callback) {
      onFrame = callback ?? undefined
    },

    async getFrameAtTime(time) {
      if (!isLoaded(state)) {
        log('getFrameAtTime: not loaded')
        return null
      }

      const { frameBuffer, duration } = state

      log('getFrameAtTime: start', { time, duration, bufferLength: frameBuffer.getLength() })

      let frameData = frameBuffer.findAt(time, true)

      if (frameData) {
        const frameTime = frameData.timestamp / 1_000_000
        const frameDuration = 1 / 30
        if (time - frameTime < frameDuration) {
          log('getFrameAtTime: found in buffer', { time, frameTime })
          bufferAhead(time)
          return dataToFrame(frameData)
        }
        log('getFrameAtTime: frame too old', { time, frameTime, diff: time - frameTime })
      }

      if (time > duration) {
        log('getFrameAtTime: time past duration, returning null', { time, duration })
        return null
      }

      const timeUs = time * 1_000_000
      const range = frameBuffer.getRange()
      const bufferEnd = frameBuffer.getLength() > 0 ? range.end * 1_000_000 : 0
      const bufferStart = frameBuffer.getLength() > 0 ? range.start * 1_000_000 : 0

      log('getFrameAtTime: buffer state', {
        timeUs,
        bufferStart,
        bufferEnd,
        bufferLength: frameBuffer.getLength(),
      })

      if (frameBuffer.getLength() > 0 && timeUs >= bufferStart && timeUs <= bufferEnd + 1_000_000) {
        log('getFrameAtTime: buffering ahead')
        await bufferAhead(time)

        frameData = frameBuffer.findAt(time, true)
        const frameTime = frameData ? frameData.timestamp / 1_000_000 : -1
        const frameDuration = 1 / 30
        if (!frameData || time - frameTime >= frameDuration) {
          log('getFrameAtTime: bufferAhead insufficient, falling back to seekToTime')
          await seekToTime(time)
        }
      } else {
        log('getFrameAtTime: seeking')
        await seekToTime(time)
      }

      frameData = frameBuffer.findAt(time, true)
      if (!frameData) {
        log('getFrameAtTime: no frame after seek/buffer', {
          time,
          bufferLength: frameBuffer.getLength(),
        })
        return null
      }

      log('getFrameAtTime: returning frame', { time, frameTs: frameData.timestamp })
      return dataToFrame(frameData)
    },

    async load(source) {
      log('load', { isSource: true })

      const preservedDecoder =
        isLoaded(state) && state.decoder.state !== 'closed'
          ? { decoder: state.decoder, config: state.videoConfig }
          : state.type === 'idle' || state.type === 'loading'
            ? state.preservedDecoder
            : undefined

      if (isLoaded(state)) {
        state.input[Symbol.dispose]?.()
      }

      state = { type: 'loading', preservedDecoder }

      const input = new Input({
        source,
        formats: ALL_FORMATS,
      })

      const videoTracks = await input.getVideoTracks()
      const videoTrack = videoTracks[0] ?? null

      if (!videoTrack) {
        state = { type: 'idle' }
        log('load complete: no video track')
        return { duration: 0, videoTrack: null }
      }

      const videoSink = new EncodedPacketSink(videoTrack)
      const videoConfig = await videoTrack.getDecoderConfig()
      const duration = await videoTrack.computeDuration()

      if (!videoConfig) {
        state = { type: 'idle' }
        log('load complete: no decoder config')
        return { duration: 0, videoTrack: null }
      }

      log('videoTrack info', {
        id: videoTrack.id,
        codedWidth: videoTrack.codedWidth,
        codedHeight: videoTrack.codedHeight,
        duration,
        videoConfig: {
          codec: videoConfig.codec,
          codedWidth: videoConfig.codedWidth,
          codedHeight: videoConfig.codedHeight,
          hasDescription: !!videoConfig.description,
        },
      })

      const firstPacket = await videoSink.getFirstPacket()
      if (firstPacket) {
        log('first packet', {
          timestamp: firstPacket.timestamp,
          duration: firstPacket.duration,
          type: firstPacket.type,
          dataSize: firstPacket.data.byteLength,
        })
      }

      const codecString = await videoTrack.getCodecParameterString()
      const videoTrackInfo: VideoTrackInfo = {
        id: videoTrack.id,
        index: 0,
        codec: codecString ?? 'unknown',
        width: videoTrack.codedWidth,
        height: videoTrack.codedHeight,
        duration,
        timescale: 1,
        sampleCount: 0,
        bitrate: 0,
      }

      const timing = createPlaybackTiming()
      const frameBuffer = createFrameBuffer()

      bufferPosition = 0
      isBuffering = false
      lastSentTimestamp = null

      let decoder: VideoDecoderHandle
      if (preservedDecoder && configsMatch(preservedDecoder.config, videoConfig)) {
        log('reusing decoder, config matches')
        decoder = preservedDecoder.decoder
        decoder.reset()
      } else {
        if (preservedDecoder) {
          preservedDecoder.decoder.close()
        }
        decoder = makeVideoDecoder({
          videoConfig: assertedNotNullish(videoConfig, 'Expected videoConfig to be defined.'),
          shouldSkipDeltaFrame,
        })
      }

      state = {
        type: 'ready',
        input,
        videoTrack,
        videoSink,
        videoConfig,
        duration,
        decoder,
        timing,
        frameBuffer,
      }

      log('load complete', { duration, hasVideo: true })

      return { duration, videoTrack: videoTrackInfo }
    },

    play(startTime, playbackSpeed = 1) {
      if (!isLoaded(state)) {
        log('play: not loaded')
        return
      }

      log('play', { startTime, playbackSpeed })

      state = transitionToPlaying(state, startTime, playbackSpeed)
      streamLoop.start()
    },

    pause() {
      if (!isLoaded(state)) {
        log('pause: not loaded')
        return
      }

      log('pause', { isPlaying: streamLoop.isRunning })

      state = transitionToPaused(state)
      streamLoop.stop()
    },

    async seek(time) {
      if (!isLoaded(state)) {
        log('seek: not loaded')
        return
      }

      log('seek', { time })
      const wasPlaying = streamLoop.isRunning

      if (wasPlaying) {
        streamLoop.stop()
      }

      state = transitionToSeeking(state, time, wasPlaying)

      await seekToTime(time)

      sendFrame(time)

      if (wasPlaying) {
        state = transitionToPlaying(state, time, state.timing.getSpeed())
        streamLoop.start()
      } else {
        state = transitionToPaused(state)
      }
    },

    getBufferRange() {
      if (!isLoaded(state)) {
        return { start: 0, end: 0 }
      }
      return state.frameBuffer.getRange()
    },

    getPerf() {
      return monitor.getAllStats()
    },

    resetPerf(): void {
      monitor.reset()
    },

    sendCurrentFrame(): void {
      if (!isLoaded(state)) return
      if (state.frameBuffer.getLength() > 0) {
        const pausedAt = state.type === 'paused' ? state.pausedAt : state.timing.getCurrentTime()
        sendFrame(pausedAt)
      }
    },
  } satisfies VideoPlayback
}
