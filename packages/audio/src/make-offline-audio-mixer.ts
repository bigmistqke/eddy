import type { AudioEffect } from '@eddy/lexicons'
import { makeDemuxer } from '@eddy/media'
import { debug } from '@eddy/utils'
import { makeAudioDecoder } from './make-audio-decoder'
import { makeEffectChain } from './make-effect-chain'

const log = debug('audio:make-offline-audio-mixer', false)

export interface TrackAudioConfig {
  /** Audio buffer containing decoded audio */
  buffer: AudioBuffer
  /** Audio effects from the track's pipeline (lexicon format) */
  effects: AudioEffect[]
  /** Start time on timeline in seconds */
  startTime: number
}

export interface OfflineAudioMixer {
  /** Add a track's audio to the mix */
  addTrack(config: TrackAudioConfig): void
  /** Render all tracks and return mixed AudioBuffer */
  render(): Promise<AudioBuffer>
}

/**
 * Create an offline audio mixer using OfflineAudioContext
 * Renders all audio faster than real-time with effects applied via the element system
 */
export function makeOfflineAudioMixer(duration: number, sampleRate = 48000): OfflineAudioMixer {
  const tracks: TrackAudioConfig[] = []

  return {
    addTrack(config) {
      log('addTrack', {
        duration: config.buffer.duration,
        effectCount: config.effects.length,
        startTime: config.startTime,
      })
      tracks.push(config)
    },

    async render() {
      log('render', { trackCount: tracks.length, duration })

      // Create offline context for the full duration
      const offlineCtx = new OfflineAudioContext({
        numberOfChannels: 2,
        length: Math.ceil(duration * sampleRate),
        sampleRate,
      })

      // Add each track with its pipeline
      for (const track of tracks) {
        // Create source
        const source = offlineCtx.createBufferSource()
        source.buffer = track.buffer

        // Build effect nodes using the element system
        const pipeline = makeEffectChain(offlineCtx, track.effects)

        // Connect: source -> pipeline -> destination
        source.connect(pipeline.input)
        pipeline.output.connect(offlineCtx.destination)

        // Start at the track's timeline position
        source.start(track.startTime)

        log('scheduled track', {
          startTime: track.startTime,
          duration: track.buffer.duration,
          elementCount: pipeline.elements.size,
        })
      }

      // Render all audio at once (faster than real-time)
      log('starting render')
      const renderedBuffer = await offlineCtx.startRendering()
      log('render complete', {
        duration: renderedBuffer.duration,
        channels: renderedBuffer.numberOfChannels,
        sampleRate: renderedBuffer.sampleRate,
      })

      return renderedBuffer
    },
  }
}

/**
 * Convert AudioData array to AudioBuffer
 * AudioData from WebCodecs needs to be converted to Web Audio API format
 */
export async function audioDataArrayToBuffer(
  audioDataArray: AudioData[],
  sampleRate = 48000,
): Promise<AudioBuffer | null> {
  if (audioDataArray.length === 0) {
    return null
  }

  // Get format info from first sample
  const firstData = audioDataArray[0]
  const numberOfChannels = firstData.numberOfChannels
  const format = firstData.format

  log('audioDataArrayToBuffer', {
    samples: audioDataArray.length,
    channels: numberOfChannels,
    format,
    sampleRate: firstData.sampleRate,
  })

  // Calculate total sample count
  let totalFrames = 0
  for (const data of audioDataArray) {
    totalFrames += data.numberOfFrames
  }

  // Create buffer
  const buffer = new AudioBuffer({
    numberOfChannels,
    length: totalFrames,
    sampleRate: sampleRate,
  })

  // Copy data to buffer
  let offset = 0
  for (const data of audioDataArray) {
    // Get channel data based on format
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const channelData = buffer.getChannelData(channel)

      // Allocate buffer for this channel's data
      const frameCount = data.numberOfFrames
      const tempBuffer = new Float32Array(frameCount)

      // Copy from AudioData to our buffer
      // AudioData.copyTo expects a specific format
      try {
        data.copyTo(tempBuffer, {
          planeIndex: channel,
          format: 'f32-planar',
        })

        // Copy to the AudioBuffer at the right offset
        channelData.set(tempBuffer, offset)
      } catch (error) {
        // If copyTo fails, try to extract data manually based on format
        log('copyTo failed, trying manual extraction', { format, error })

        if (format === 'f32' || format === 'f32-planar') {
          // Already float, copy directly
          data.copyTo(tempBuffer, { planeIndex: channel })
          channelData.set(tempBuffer, offset)
        } else if (format === 's16' || format === 's16-planar') {
          // Convert int16 to float32
          const int16Buffer = new Int16Array(frameCount)
          data.copyTo(int16Buffer, { planeIndex: channel })
          for (let i = 0; i < frameCount; i++) {
            tempBuffer[i] = int16Buffer[i] / 32768
          }
          channelData.set(tempBuffer, offset)
        }
      }
    }

    offset += data.numberOfFrames
  }

  return buffer
}

/**
 * Extract audio samples from AudioBuffer for a specific time range
 * Returns Float32Array per channel suitable for muxer
 */
export function extractAudioChunk(
  buffer: AudioBuffer,
  startSample: number,
  endSample: number,
): Float32Array[] {
  const channels: Float32Array[] = []
  const length = Math.min(endSample - startSample, buffer.length - startSample)

  if (length <= 0) {
    // Return empty channels
    for (let i = 0; i < buffer.numberOfChannels; i++) {
      channels.push(new Float32Array(0))
    }
    return channels
  }

  for (let i = 0; i < buffer.numberOfChannels; i++) {
    const channelData = buffer.getChannelData(i)
    const chunk = channelData.slice(startSample, startSample + length)
    channels.push(chunk)
  }

  return channels
}

/**
 * Decode audio from a clip buffer (ArrayBuffer containing video/audio file)
 * Returns AudioBuffer ready for mixing, or null if no audio track
 */
export async function decodeClipAudio(
  buffer: ArrayBuffer,
  targetSampleRate = 48000,
): Promise<AudioBuffer | null> {
  log('decodeClipAudio', { size: buffer.byteLength })

  try {
    // Create demuxer
    const demuxer = await makeDemuxer(buffer)

    // Check for audio track
    if (demuxer.info.audioTracks.length === 0) {
      log('no audio track found')
      demuxer.destroy()
      return null
    }

    const audioTrack = demuxer.info.audioTracks[0]
    log('found audio track', {
      codec: audioTrack.codec,
      sampleRate: audioTrack.sampleRate,
      channels: audioTrack.channelCount,
      duration: audioTrack.duration,
    })

    // Get all audio samples
    const samples = await demuxer.getAllSamples(audioTrack.id)
    log('got samples', { count: samples.length })

    if (samples.length === 0) {
      demuxer.destroy()
      return null
    }

    // Create decoder
    const decoder = await makeAudioDecoder(demuxer, audioTrack)

    // Decode all samples
    const audioDataArray = await decoder.decodeAll(samples)
    log('decoded samples', { count: audioDataArray.length })

    // Convert to AudioBuffer
    const audioBuffer = await audioDataArrayToBuffer(audioDataArray, targetSampleRate)

    // Cleanup
    for (const data of audioDataArray) {
      data.close()
    }
    decoder.close()
    demuxer.destroy()

    return audioBuffer
  } catch (error) {
    log('decodeClipAudio error', { error })
    return null
  }
}
