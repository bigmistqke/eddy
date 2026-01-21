/**
 * CreateAudioPlayback
 *
 * Handles demuxing, decoding, and audio buffering for smooth audio playback.
 * Uses a state machine with discriminated unions to prevent impossible states.
 */

import type { AudioTrackInfo, DemuxedSample } from '@eddy/media'
import { debug, makeMonitor, makeLoop } from '@eddy/utils'
import {
  ALL_FORMATS,
  EncodedPacketSink,
  Input,
  type EncodedPacket,
  type InputAudioTrack,
  type Source,
} from 'mediabunny'

const log = debug('playback:make-audio-playback', false)

/** Buffer configuration */
const BUFFER_AHEAD_SECONDS = 2.0
const BUFFER_MAX_SAMPLES = 60

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

/** Audio playback state */
export type AudioPlaybackState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'seeking'

/** Audio output callback - receives decoded AudioData */
export type AudioCallback = (audioData: AudioData) => void

/** End callback - called when playback reaches the end */
export type EndCallback = () => void

/** Audio playback configuration */
export interface AudioPlaybackConfig {
  /** Callback when decoded audio is ready */
  onAudio?: AudioCallback
  /** Callback when playback reaches the end of media */
  onEnd?: EndCallback
}

/** Buffered audio sample */
interface BufferedAudio {
  /** Media timestamp in microseconds */
  timestamp: number
  /** Duration in microseconds */
  duration: number
  /** Sample rate of the audio */
  sampleRate: number
  /** Number of channels */
  numberOfChannels: number
  /** Audio format */
  format: AudioSampleFormat
  /** Audio data per channel (planar) */
  channels: Float32Array[]
}

/** Preserved decoder state for reuse across loads */
interface PreservedDecoder {
  decoder: AudioDecoder
  config: AudioDecoderConfig
}

/** Loaded resources (available in ready/playing/paused/seeking states) */
interface LoadedResources {
  input: Input
  audioTrack: InputAudioTrack
  audioSink: EncodedPacketSink
  audioConfig: AudioDecoderConfig
  duration: number
  decoder: AudioDecoder
  timing: PlaybackTiming
  buffer: AudioBuffer
}

/** Playback timing interface */
interface PlaybackTiming {
  getCurrentTime(): number
  start(mediaTime: number, playbackSpeed: number): void
  pause(): number
  setSpeed(speed: number): void
  getSpeed(): number
}

/** Audio buffer interface */
interface AudioBuffer {
  insert(audio: BufferedAudio): void
  findAt(timeSeconds: number): BufferedAudio | null
  trimBefore(timeSeconds: number, keepPastSeconds?: number): void
  clear(): void
  getRange(): { start: number; end: number }
  getLength(): number
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
 * AudioPlayback handles demuxing, decoding, and audio buffering
 * for smooth audio playback. It manages its own internal state and
 * timing, outputting AudioData via callback.
 */
export interface AudioPlayback {
  /** Whether playback is active */
  readonly isPlaying: boolean
  /** Audio duration in seconds */
  readonly audioDuration: number
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
  getState(): AudioPlaybackState
  /** Load audio from source */
  load(source: Source): Promise<{
    duration: number
    audioTrack: AudioTrackInfo | null
  }>
  /** Pause playback */
  pause(): void
  /** Start playback from time at speed */
  play(startTime: number, playbackSpeed?: number): void
  /** Reset performance stats */
  resetPerf(): void
  /** Seek to time */
  seek(time: number): Promise<void>
  /** Set audio output callback */
  setAudioCallback(callback: AudioCallback | null): void
  /** Get audio at specific time (for export) */
  getAudioAtTime(time: number): Promise<AudioData | null>
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
    isKeyframe: true, // Audio frames are always keyframes
    data: packet.data,
    size: packet.data.byteLength,
  }
}

/** Check if two AudioDecoderConfigs are equivalent */
function configsMatch(a: AudioDecoderConfig | null, b: AudioDecoderConfig | null): boolean {
  if (!a || !b) return false
  return (
    a.codec === b.codec &&
    a.sampleRate === b.sampleRate &&
    a.numberOfChannels === b.numberOfChannels
  )
}

/** Extract samples from AudioData to Float32Array per channel */
function audioDataToBuffered(audioData: AudioData): BufferedAudio {
  const numberOfChannels = audioData.numberOfChannels
  const numberOfFrames = audioData.numberOfFrames
  const format = audioData.format as AudioSampleFormat

  const channels: Float32Array[] = []

  if (format === 'f32-planar') {
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const channelData = new Float32Array(numberOfFrames)
      audioData.copyTo(channelData, { planeIndex: ch })
      channels.push(channelData)
    }
  } else if (format === 'f32') {
    const byteSize = audioData.allocationSize({ planeIndex: 0 })
    const tempBuffer = new ArrayBuffer(byteSize)
    audioData.copyTo(tempBuffer, { planeIndex: 0 })
    const interleaved = new Float32Array(tempBuffer)
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const channelData = new Float32Array(numberOfFrames)
      for (let index = 0; index < numberOfFrames; index++) {
        channelData[index] = interleaved[index * numberOfChannels + ch]
      }
      channels.push(channelData)
    }
  } else if (format === 's16') {
    const byteSize = audioData.allocationSize({ planeIndex: 0 })
    const tempBuffer = new ArrayBuffer(byteSize)
    audioData.copyTo(tempBuffer, { planeIndex: 0 })
    const interleaved = new Int16Array(tempBuffer)
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const channelData = new Float32Array(numberOfFrames)
      for (let index = 0; index < numberOfFrames; index++) {
        channelData[index] = interleaved[index * numberOfChannels + ch] / 32768
      }
      channels.push(channelData)
    }
  } else {
    // Fallback: try format conversion
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const channelData = new Float32Array(numberOfFrames)
      try {
        audioData.copyTo(channelData, { planeIndex: ch, format: 'f32-planar' })
      } catch {
        channelData.fill(0)
      }
      channels.push(channelData)
    }
  }

  return {
    timestamp: audioData.timestamp,
    duration: audioData.duration,
    sampleRate: audioData.sampleRate,
    numberOfChannels,
    format: 'f32-planar',
    channels,
  }
}

/** Convert buffered audio back to AudioData */
function bufferedToAudioData(buffered: BufferedAudio): AudioData {
  const totalSamples = buffered.channels[0].length * buffered.numberOfChannels
  const data = new Float32Array(totalSamples)

  for (let ch = 0; ch < buffered.numberOfChannels; ch++) {
    data.set(buffered.channels[ch], ch * buffered.channels[0].length)
  }

  return new AudioData({
    format: 'f32-planar',
    sampleRate: buffered.sampleRate,
    numberOfFrames: buffered.channels[0].length,
    numberOfChannels: buffered.numberOfChannels,
    timestamp: buffered.timestamp,
    data,
  })
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
/*                              Create Audio Buffer                               */
/*                                                                                */
/**********************************************************************************/

/** Create audio buffer manager */
function createAudioBuffer(maxSamples: number = BUFFER_MAX_SAMPLES): AudioBuffer {
  let samples: BufferedAudio[] = []

  return {
    insert(audio: BufferedAudio): void {
      const insertIndex = samples.findIndex(sample => sample.timestamp > audio.timestamp)
      if (insertIndex === -1) {
        samples.push(audio)
      } else {
        samples.splice(insertIndex, 0, audio)
      }

      while (samples.length > maxSamples) {
        samples.shift()
      }
    },

    findAt(timeSeconds: number): BufferedAudio | null {
      if (samples.length === 0) return null

      const timeUs = timeSeconds * 1_000_000
      let best: BufferedAudio | null = null

      for (const audio of samples) {
        if (audio.timestamp <= timeUs && audio.timestamp + audio.duration > timeUs) {
          best = audio
          break
        }
        if (audio.timestamp <= timeUs) {
          best = audio
        }
      }

      return best
    },

    trimBefore(timeSeconds: number, keepPastSeconds = 0.5): void {
      const minTimestamp = (timeSeconds - keepPastSeconds) * 1_000_000

      while (samples.length > 1 && samples[0].timestamp + samples[0].duration < minTimestamp) {
        samples.shift()
      }
    },

    clear(): void {
      samples = []
    },

    getRange(): { start: number; end: number } {
      if (samples.length === 0) {
        return { start: 0, end: 0 }
      }
      const lastAudio = samples[samples.length - 1]
      return {
        start: samples[0].timestamp / 1_000_000,
        end: (lastAudio.timestamp + lastAudio.duration) / 1_000_000,
      }
    },

    getLength(): number {
      return samples.length
    },
  }
}

/**********************************************************************************/
/*                                                                                */
/*                             Create Audio Playback                              */
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

/** Create a new audio playback engine instance */
export function makeAudioPlayback({ onAudio, onEnd }: AudioPlaybackConfig = {}): AudioPlayback {
  const monitor = makeMonitor<'demux' | 'decode' | 'transferAudio'>()

  let state: PlaybackStateMachine = { type: 'idle' }

  let bufferPosition = 0
  let isBuffering = false
  let lastSentTimestamp: number | null = null
  let pendingResolve: ((audioData: AudioData) => void) | null = null

  function createDecoder(config: AudioDecoderConfig, buffer: AudioBuffer): AudioDecoder {
    const decoder = new AudioDecoder({
      output: (audioData: AudioData) => {
        if (pendingResolve) {
          pendingResolve(audioData)
          pendingResolve = null
        } else if (state.type === 'playing' && onAudio) {
          onAudio(audioData)
        } else {
          const buffered = audioDataToBuffered(audioData)
          audioData.close()
          buffer.insert(buffered)
        }
      },
      error: (error: DOMException) => {
        console.error('[audio-playback] decoder error:', error)
      },
    })

    decoder.configure(config)
    return decoder
  }

  const transferAudio = monitor('transferAudio', (buffered: BufferedAudio, callback: AudioCallback) => {
    const audioData = bufferedToAudioData(buffered)
    lastSentTimestamp = buffered.timestamp
    callback(audioData)
  })

  function sendAudio(time: number): void {
    if (!onAudio || !isLoaded(state)) return

    const buffered = state.buffer.findAt(time)
    if (!buffered) return

    if (buffered.timestamp === lastSentTimestamp) {
      return
    }

    transferAudio(buffered, onAudio)
  }

  async function decodePacket(
    packet: EncodedPacket,
    decoder: AudioDecoder,
    audioTrack: InputAudioTrack,
  ): Promise<AudioData | null> {
    const sample = packetToSample(packet, audioTrack.id)
    const chunk = new EncodedAudioChunk({
      type: 'key',
      timestamp: sample.timestamp * 1_000_000,
      duration: sample.duration * 1_000_000,
      data: sample.data,
    })

    return new Promise(resolve => {
      pendingResolve = resolve
      decoder.decode(chunk)
    })
  }

  const demux = monitor('demux', <T>(operation: () => T): T => operation())
  const decode = monitor('decode', (
    packet: EncodedPacket,
    decoder: AudioDecoder,
    audioTrack: InputAudioTrack,
  ) => decodePacket(packet, decoder, audioTrack))

  async function bufferAhead(fromTime: number): Promise<void> {
    if (!isLoaded(state)) return
    if (isBuffering) return

    const { audioSink, audioTrack, duration, decoder, buffer } = state

    const targetEnd = Math.min(fromTime + BUFFER_AHEAD_SECONDS, duration)
    if (bufferPosition >= targetEnd) return

    isBuffering = true

    log('bufferAhead', { fromTime, targetEnd, bufferPosition })

    const streamDirectly = !!onAudio

    try {
      let packet = await demux(async () => {
        const pkt = await audioSink.getPacket(bufferPosition)
        return pkt ?? (await audioSink.getFirstPacket())
      })

      while (packet && packet.timestamp < targetEnd) {
        const audioData = await decode(packet, decoder, audioTrack)

        if (audioData) {
          if (streamDirectly) {
            onAudio!(audioData)
          } else {
            const buffered = audioDataToBuffered(audioData)
            audioData.close()
            buffer.insert(buffered)
          }

          bufferPosition = packet.timestamp + packet.duration
        }

        packet = await demux(() => audioSink.getNextPacket(packet!))
      }
    } catch (error) {
      console.error('[playback:audio] bufferAhead error', error)
    } finally {
      isBuffering = false
    }
  }

  async function seekToTime(time: number): Promise<void> {
    if (!isLoaded(state)) return

    log('seekToTime: starting', { time })

    const { audioSink, audioConfig, decoder, buffer } = state

    buffer.clear()
    lastSentTimestamp = null
    isBuffering = false

    if (decoder.state !== 'closed') {
      decoder.reset()
      decoder.configure(audioConfig)
    }

    const packet = await audioSink.getPacket(time)
    bufferPosition = packet?.timestamp ?? 0

    await bufferAhead(time)

    log('seekToTime: done', { audioBuffered: buffer.getLength() })
  }

  const streamLoop = makeLoop(loop => {
    if (!isLoaded(state)) {
      loop.stop()
      return
    }

    const time = state.timing.getCurrentTime()
    const { duration, buffer } = state

    if (duration > 0 && time >= duration) {
      log('streamLoop: reached end', { time, duration })
      const pausedAt = state.timing.pause()
      state = { ...state, type: 'paused', pausedAt }
      loop.stop()
      onEnd?.()
      return
    }

    sendAudio(time)
    buffer.trimBefore(time)
    bufferAhead(time)
  })

  return {
    get isPlaying() {
      return streamLoop.isRunning
    },

    get audioDuration() {
      return isLoaded(state) ? state.duration : 0
    },

    getState(): AudioPlaybackState {
      return state.type
    },

    setAudioCallback(callback) {
      onAudio = callback ?? undefined
    },

    async getAudioAtTime(time) {
      if (!isLoaded(state)) {
        log('getAudioAtTime: not loaded')
        return null
      }

      const { buffer, duration } = state

      log('getAudioAtTime: start', { time, duration, bufferLength: buffer.getLength() })

      let buffered = buffer.findAt(time)
      if (buffered) {
        const audioTime = buffered.timestamp / 1_000_000
        const audioDuration = buffered.duration / 1_000_000
        if (time >= audioTime && time < audioTime + audioDuration) {
          log('getAudioAtTime: found in buffer', { time, audioTime })
          bufferAhead(time)
          return bufferedToAudioData(buffered)
        }
      }

      if (time > duration) {
        log('getAudioAtTime: time past duration', { time, duration })
        return null
      }

      await seekToTime(time)

      buffered = buffer.findAt(time)
      if (!buffered) {
        log('getAudioAtTime: no audio after seek', { time, bufferLength: buffer.getLength() })
        return null
      }

      log('getAudioAtTime: returning audio', { time, audioTs: buffered.timestamp })
      return bufferedToAudioData(buffered)
    },

    async load(source) {
      log('load', { isSource: true })

      const preservedDecoder =
        isLoaded(state) && state.decoder.state !== 'closed'
          ? { decoder: state.decoder, config: state.audioConfig }
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

      const audioTracks = await input.getAudioTracks()
      const audioTrack = audioTracks[0] ?? null

      if (!audioTrack) {
        state = { type: 'idle' }
        log('load complete: no audio track')
        return { duration: 0, audioTrack: null }
      }

      const audioSink = new EncodedPacketSink(audioTrack)
      const audioConfig = await audioTrack.getDecoderConfig()
      const duration = await audioTrack.computeDuration()

      if (!audioConfig) {
        state = { type: 'idle' }
        log('load complete: no decoder config')
        return { duration: 0, audioTrack: null }
      }

      log('audioTrack info', {
        id: audioTrack.id,
        sampleRate: audioTrack.sampleRate,
        channels: audioTrack.numberOfChannels,
        duration,
      })

      const codecString = await audioTrack.getCodecParameterString()
      const audioTrackInfo: AudioTrackInfo = {
        id: audioTrack.id,
        index: 0,
        codec: codecString ?? 'unknown',
        sampleRate: audioTrack.sampleRate,
        channelCount: audioTrack.numberOfChannels,
        sampleSize: 16,
        duration,
        timescale: 1,
        sampleCount: 0,
        bitrate: 0,
      }

      const timing = createPlaybackTiming()
      const buffer = createAudioBuffer()

      bufferPosition = 0
      isBuffering = false
      lastSentTimestamp = null

      let decoder: AudioDecoder
      if (preservedDecoder && configsMatch(preservedDecoder.config, audioConfig)) {
        log('reusing decoder, config matches')
        decoder = preservedDecoder.decoder
        decoder.reset()
        decoder.configure(audioConfig)
      } else {
        if (preservedDecoder && preservedDecoder.decoder.state !== 'closed') {
          preservedDecoder.decoder.close()
        }
        decoder = createDecoder(audioConfig, buffer)
      }

      state = {
        type: 'ready',
        input,
        audioTrack,
        audioSink,
        audioConfig,
        duration,
        decoder,
        timing,
        buffer,
      }

      log('load complete', { duration, hasAudio: true })

      return { duration, audioTrack: audioTrackInfo }
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

      sendAudio(time)

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
      return state.buffer.getRange()
    },

    getPerf() {
      return monitor.getAllStats()
    },

    resetPerf(): void {
      monitor.reset()
    },
  } satisfies AudioPlayback
}
