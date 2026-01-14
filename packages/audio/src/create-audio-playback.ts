import type { AudioTrackInfo, DemuxedSample } from '@eddy/media'
import { createLoop, createPerfMonitor, debug } from '@eddy/utils'
import {
  ALL_FORMATS,
  BlobSource,
  EncodedPacketSink,
  Input,
  type EncodedPacket,
  type InputAudioTrack,
} from 'mediabunny'

const log = debug('playback:create-audio-playback', false)

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

/** Audio playback configuration */
export interface AudioPlaybackConfig {
  /** Callback when decoded audio is ready */
  onAudio?: AudioCallback
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
  getBufferRange(): {
    start: number
    end: number
  }
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
  /** Load audio from buffer */
  load(buffer: ArrayBuffer): Promise<{
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

/** Convert packet to sample format */
function packetToSample(packet: EncodedPacket, trackId: number): DemuxedSample {
  return {
    number: 0,
    trackId,
    pts: packet.timestamp,
    dts: packet.timestamp,
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
    a.codec === b.codec && a.sampleRate === b.sampleRate && a.numberOfChannels === b.numberOfChannels
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
      for (let i = 0; i < numberOfFrames; i++) {
        channelData[i] = interleaved[i * numberOfChannels + ch]
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
      for (let i = 0; i < numberOfFrames; i++) {
        channelData[i] = interleaved[i * numberOfChannels + ch] / 32768
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
  // Calculate total size for planar format
  const totalSamples = buffered.channels[0].length * buffered.numberOfChannels
  const data = new Float32Array(totalSamples)

  // Copy channels in planar layout
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
/*                                 Create Playback                                */
/*                                                                                */
/**********************************************************************************/

/**
 * Create a new audio playback engine instance
 */
export function createAudioPlayback({ onAudio }: AudioPlaybackConfig = {}): AudioPlayback {
  const perf = createPerfMonitor()

  // Demuxer state
  let input: Input | null = null
  let audioTrack: InputAudioTrack | null = null
  let audioSink: EncodedPacketSink | null = null
  let audioConfig: AudioDecoderConfig | null = null
  let duration = 0

  // Decoder
  let decoder: AudioDecoder | null = null

  // Buffer state
  let audioBuffer: BufferedAudio[] = []
  let bufferPosition = 0
  let isBuffering = false

  // Playback timing state
  let startWallTime = 0
  let startMediaTime = 0
  let speed = 1

  // State tracking
  let _state: AudioPlaybackState = 'idle'
  let lastSentTimestamp: number | null = null

  // Pending decode promises
  let pendingResolve: ((audioData: AudioData) => void) | null = null

  function createDecoder(): void {
    if (!audioConfig) return

    decoder = new AudioDecoder({
      output: (audioData: AudioData) => {
        if (pendingResolve) {
          pendingResolve(audioData)
          pendingResolve = null
        } else if (_state === 'playing' && onAudio) {
          // During playback, send directly to ring buffer (no buffering bottleneck)
          onAudio(audioData)
        } else {
          // Buffer the audio for seeking/export
          const buffered = audioDataToBuffered(audioData)
          audioData.close()

          // Insert in sorted order
          const insertIndex = audioBuffer.findIndex(a => a.timestamp > buffered.timestamp)
          if (insertIndex === -1) {
            audioBuffer.push(buffered)
          } else {
            audioBuffer.splice(insertIndex, 0, buffered)
          }

          // Trim old audio
          while (audioBuffer.length > BUFFER_MAX_SAMPLES) {
            audioBuffer.shift()
          }
        }
      },
      error: (error: DOMException) => {
        console.error('[audio-playback] decoder error:', error)
      },
    })

    decoder.configure(audioConfig)
  }

  function sendAudio(time: number): void {
    if (!onAudio) return

    const buffered = findBufferedAudio(time)
    if (!buffered) return

    // Skip if same audio
    if (buffered.timestamp === lastSentTimestamp) {
      return
    }

    // Create AudioData and send to callback
    perf.start('transferAudio')
    const audioData = bufferedToAudioData(buffered)
    lastSentTimestamp = buffered.timestamp
    onAudio(audioData)
    perf.end('transferAudio')
  }

  function findBufferedAudio(timeSeconds: number): BufferedAudio | null {
    if (audioBuffer.length === 0) return null

    const timeUs = timeSeconds * 1_000_000
    let best: BufferedAudio | null = null

    for (const audio of audioBuffer) {
      if (audio.timestamp <= timeUs && audio.timestamp + audio.duration > timeUs) {
        best = audio
        break
      }
      if (audio.timestamp <= timeUs) {
        best = audio
      }
    }

    return best
  }

  async function decodePacket(packet: EncodedPacket): Promise<AudioData | null> {
    if (!decoder || !audioTrack) return null

    const sample = packetToSample(packet, audioTrack.id)
    const chunk = new EncodedAudioChunk({
      type: 'key',
      timestamp: sample.pts * 1_000_000,
      duration: sample.duration * 1_000_000,
      data: sample.data,
    })

    return new Promise(resolve => {
      pendingResolve = resolve
      decoder!.decode(chunk)
    })
  }

  async function bufferAhead(fromTime: number): Promise<void> {
    if (!audioSink || !audioTrack || !decoder) return
    if (isBuffering) return

    const targetEnd = Math.min(fromTime + BUFFER_AHEAD_SECONDS, duration)
    if (bufferPosition >= targetEnd) return

    isBuffering = true
    perf.start('bufferAhead')
    log('bufferAhead', { fromTime, targetEnd, bufferPosition })

    // Stream directly to onAudio (ring buffer) when callback is set
    const streamDirectly = !!onAudio

    try {
      perf.start('demux')
      let packet = await audioSink.getPacket(bufferPosition)
      if (!packet) {
        packet = await audioSink.getFirstPacket()
      }
      perf.end('demux')

      while (packet && packet.timestamp < targetEnd) {
        perf.start('decode')
        const audioData = await decodePacket(packet)
        perf.end('decode')

        if (audioData) {
          if (streamDirectly) {
            // Send directly to ring buffer during playback
            onAudio!(audioData)
          } else {
            // Buffer for seeking/export
            const buffered = audioDataToBuffered(audioData)
            audioData.close()

            // Insert in sorted order
            const insertIndex = audioBuffer.findIndex(a => a.timestamp > buffered.timestamp)
            if (insertIndex === -1) {
              audioBuffer.push(buffered)
            } else {
              audioBuffer.splice(insertIndex, 0, buffered)
            }

            while (audioBuffer.length > BUFFER_MAX_SAMPLES) {
              audioBuffer.shift()
            }
          }

          bufferPosition = packet.timestamp + packet.duration
        }

        perf.start('demux')
        packet = await audioSink.getNextPacket(packet)
        perf.end('demux')
      }
    } catch (error) {
      console.error('[playback:audio] bufferAhead error', error)
    } finally {
      perf.end('bufferAhead')
      isBuffering = false
    }
  }

  async function seekToTime(time: number): Promise<void> {
    log('seekToTime: starting', { time })

    // Clear buffer
    audioBuffer = []
    lastSentTimestamp = null
    isBuffering = false

    // Reset decoder
    if (decoder && decoder.state !== 'closed') {
      decoder.reset()
      if (audioConfig) {
        decoder.configure(audioConfig)
      }
    }

    if (!audioSink || !audioTrack || !decoder) {
      return
    }

    // For audio, all frames are keyframes, so we can seek directly
    const packet = await audioSink.getPacket(time)
    bufferPosition = packet?.timestamp ?? 0

    // Buffer from seek position
    await bufferAhead(time)

    log('seekToTime: done', { audioBuffered: audioBuffer.length })
  }

  function getCurrentMediaTime(): number {
    if (!streamLoop.isRunning) return startMediaTime
    const elapsed = (performance.now() - startWallTime) / 1000
    return startMediaTime + elapsed * speed
  }

  function trimOldAudio(currentTime: number): void {
    const keepPastSeconds = 0.5
    const minTimestamp = (currentTime - keepPastSeconds) * 1_000_000

    while (audioBuffer.length > 1 && audioBuffer[0].timestamp + audioBuffer[0].duration < minTimestamp) {
      audioBuffer.shift()
    }
  }

  const streamLoop = createLoop(loop => {
    const time = getCurrentMediaTime()

    if (duration > 0 && time >= duration) {
      log('streamLoop: reached end', { time, duration })
      _state = 'paused'
      loop.stop()
      return
    }

    // Send audio to callback
    sendAudio(time)

    // Trim old audio
    trimOldAudio(time)

    // Buffer ahead
    bufferAhead(time)
  })

  return {
    get isPlaying() {
      return streamLoop.isRunning
    },

    get audioDuration() {
      return duration
    },

    getState() {
      return _state
    },

    setAudioCallback(callback) {
      onAudio = callback ?? undefined
    },

    async getAudioAtTime(time) {
      log('getAudioAtTime: start', { time, duration, bufferLength: audioBuffer.length })

      // Check buffer first
      let buffered = findBufferedAudio(time)
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

      // Need to seek/buffer
      await seekToTime(time)

      buffered = findBufferedAudio(time)
      if (!buffered) {
        log('getAudioAtTime: no audio after seek', { time, bufferLength: audioBuffer.length })
        return null
      }

      log('getAudioAtTime: returning audio', { time, audioTs: buffered.timestamp })
      return bufferedToAudioData(buffered)
    },

    async load(buffer) {
      log('load', { size: buffer.byteLength })
      _state = 'loading'

      const previousConfig = audioConfig

      // Clean up previous
      if (input) {
        input[Symbol.dispose]?.()
        input = null
      }
      audioTrack = null
      audioSink = null
      audioBuffer = []
      bufferPosition = 0

      // Create input from buffer
      const blob = new Blob([buffer])
      input = new Input({
        source: new BlobSource(blob),
        formats: ALL_FORMATS,
      })

      // Get audio track
      const audioTracks = await input.getAudioTracks()
      audioTrack = audioTracks[0] ?? null

      let audioTrackInfo: AudioTrackInfo | null = null

      if (audioTrack) {
        audioSink = new EncodedPacketSink(audioTrack)
        audioConfig = await audioTrack.getDecoderConfig()
        duration = await audioTrack.computeDuration()

        log('audioTrack info', {
          id: audioTrack.id,
          sampleRate: audioTrack.sampleRate,
          channels: audioTrack.numberOfChannels,
          duration,
        })

        const codecString = await audioTrack.getCodecParameterString()
        audioTrackInfo = {
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

        // Reuse decoder if config matches
        if (decoder && decoder.state !== 'closed' && configsMatch(previousConfig, audioConfig)) {
          log('reusing decoder, config matches')
          decoder.reset()
          decoder.configure(audioConfig!)
        } else {
          if (decoder && decoder.state !== 'closed') {
            decoder.close()
          }
          createDecoder()
        }
      }

      _state = 'ready'
      log('load complete', { duration, hasAudio: !!audioTrack })

      return { duration, audioTrack: audioTrackInfo }
    },

    play(startTime, playbackSpeed = 1) {
      log('play', { startTime, playbackSpeed })

      startMediaTime = startTime
      startWallTime = performance.now()
      speed = playbackSpeed
      _state = 'playing'

      streamLoop.start()
    },

    pause() {
      log('pause', { isPlaying: streamLoop.isRunning })

      startMediaTime = getCurrentMediaTime()
      _state = 'paused'

      streamLoop.stop()
    },

    async seek(time) {
      log('seek', { time, hasAudioSink: !!audioSink })
      const wasPlaying = streamLoop.isRunning

      if (wasPlaying) {
        streamLoop.stop()
      }

      _state = 'seeking'

      await seekToTime(time)

      startMediaTime = time

      sendAudio(time)

      if (wasPlaying) {
        startWallTime = performance.now()
        _state = 'playing'
        streamLoop.start()
      } else {
        _state = 'paused'
      }
    },

    getBufferRange() {
      if (audioBuffer.length === 0) {
        return { start: 0, end: 0 }
      }
      const lastAudio = audioBuffer[audioBuffer.length - 1]
      return {
        start: audioBuffer[0].timestamp / 1_000_000,
        end: (lastAudio.timestamp + lastAudio.duration) / 1_000_000,
      }
    },

    getPerf() {
      return perf.getAllStats()
    },

    resetPerf(): void {
      perf.reset()
    },
  } satisfies AudioPlayback
}
