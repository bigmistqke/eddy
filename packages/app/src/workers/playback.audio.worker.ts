import { expose, transfer } from '@bigmistqke/rpc/messenger'
import {
  createAudioPlayback,
  createRingBufferWriter,
  type AudioPlaybackState,
  type RingBufferWriter,
} from '@eddy/audio'
import type { AudioTrackInfo } from '@eddy/media'
import { createLoop, debug } from '@eddy/utils'
import { makeOPFSSource } from '~/opfs'

const log = debug('audio-playback-worker', false)

/** Buffer ahead by this many seconds */
const BUFFER_AHEAD_SECONDS = 0.5

export interface AudioPlaybackWorkerMethods {
  /** Set ring buffer for writing decoded audio samples */
  setRingBuffer(
    sampleBuffer: SharedArrayBuffer,
    controlBuffer: SharedArrayBuffer,
    targetSampleRate: number,
  ): void

  /** Load a clip from OPFS for playback */
  load(clipId: string): Promise<{ duration: number; audioTrack: AudioTrackInfo | null }>

  /** Start playback from time at speed */
  play(startTime: number, playbackSpeed?: number): void

  /** Pause playback */
  pause(): void

  /** Seek to time */
  seek(time: number): Promise<void>

  /** Get current buffer range */
  getBufferRange(): { start: number; end: number }

  /** Get current state */
  getState(): AudioPlaybackState

  /** Get performance stats */
  getPerf(): Record<
    string,
    { samples: number; avg: number; max: number; min: number; overThreshold: number }
  >

  /** Reset performance stats */
  resetPerf(): void

  /** Get audio at specific time (for export) */
  getAudioAtTime(time: number): Promise<AudioData | null>
}

/**********************************************************************************/
/*                                                                                */
/*                                     State                                      */
/*                                                                                */
/**********************************************************************************/

// Unique worker ID for debugging
const workerId = Math.random().toString(36).substring(2, 8)
log('Worker created with ID:', workerId)

// Ring buffer writer for decoded audio
let ringBufferWriter: RingBufferWriter | null = null
let targetSampleRate: number | null = null

// Scheduling state - pending samples queue
interface PendingSample {
  mediaTime: number // in seconds
  channels: Float32Array[]
  sampleRate: number
}
const pendingSamples: PendingSample[] = []

// Playback timing state
let isPlaying = false
let playbackStartTime = 0 // performance.now() when play started
let playbackStartMediaTime = 0 // media time when play started
let pausedMediaTime = 0

/** Get current media time based on wall clock */
function getCurrentMediaTime(): number {
  if (!isPlaying) return pausedMediaTime
  const elapsed = (performance.now() - playbackStartTime) / 1000
  return playbackStartMediaTime + elapsed
}

/** Simple linear interpolation resampling */
function resample(input: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return input

  const ratio = inputRate / outputRate
  const outputLength = Math.floor(input.length / ratio)
  const output = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio
    const srcIndexFloor = Math.floor(srcIndex)
    const srcIndexCeil = Math.min(srcIndexFloor + 1, input.length - 1)
    const t = srcIndex - srcIndexFloor
    output[i] = input[srcIndexFloor] * (1 - t) + input[srcIndexCeil] * t
  }

  return output
}

/** Extract samples from AudioData to Float32Array per channel */
function extractAudioSamples(audioData: AudioData): Float32Array[] {
  const numberOfChannels = audioData.numberOfChannels
  const numberOfFrames = audioData.numberOfFrames
  const format = audioData.format

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
    // Fallback
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

  return channels
}

/** Schedule decoded audio for playback */
function scheduleAudio(audioData: AudioData): void {
  // Extract samples
  const channels = extractAudioSamples(audioData)
  const sampleRate = audioData.sampleRate
  const mediaTime = audioData.timestamp / 1_000_000 // Convert from microseconds to seconds

  // Add to pending queue (keep sorted by media time)
  const sample: PendingSample = { mediaTime, channels, sampleRate }
  let inserted = false
  for (let i = 0; i < pendingSamples.length; i++) {
    if (mediaTime < pendingSamples[i].mediaTime) {
      pendingSamples.splice(i, 0, sample)
      inserted = true
      break
    }
  }
  if (!inserted) {
    pendingSamples.push(sample)
  }

  // Immediately try to flush
  flushPendingSamples()
}

/** Flush pending samples to ring buffer up to current time + buffer ahead */
function flushPendingSamples(): void {
  if (!ringBufferWriter || !targetSampleRate) return
  if (!isPlaying) return

  const currentMedia = getCurrentMediaTime()
  const targetTime = currentMedia + BUFFER_AHEAD_SECONDS

  while (pendingSamples.length > 0) {
    const sample = pendingSamples[0]
    const sampleDuration = sample.channels[0].length / sample.sampleRate

    // Skip samples in the past
    if (sample.mediaTime + sampleDuration < currentMedia) {
      log('skipping past sample', { sampleTime: sample.mediaTime, currentMedia })
      pendingSamples.shift()
      continue
    }

    // Stop if we've buffered enough ahead
    if (sample.mediaTime > targetTime) break

    // Resample if needed
    let channelsToWrite = sample.channels
    if (sample.sampleRate !== targetSampleRate) {
      channelsToWrite = sample.channels.map(ch =>
        resample(ch, sample.sampleRate, targetSampleRate!),
      )
    }

    // Try to write to ring buffer
    const frameCount = channelsToWrite[0].length
    const written = ringBufferWriter.write(channelsToWrite, frameCount)

    if (written === frameCount) {
      // Full write - remove from queue
      pendingSamples.shift()
    } else if (written > 0) {
      // Partial write - trim the sample
      const ratio = sample.sampleRate / targetSampleRate
      const originalWritten = Math.floor(written * ratio)
      for (let ch = 0; ch < sample.channels.length; ch++) {
        sample.channels[ch] = sample.channels[ch].slice(originalWritten)
      }
      sample.mediaTime += originalWritten / sample.sampleRate
      break // Buffer is full
    } else {
      break // Buffer is full
    }
  }
}

// Scheduling loop - runs during playback to keep flushing samples
const schedulingLoop = createLoop(() => {
  if (!isPlaying) {
    schedulingLoop.stop()
    return
  }
  flushPendingSamples()
})

/**********************************************************************************/
/*                                                                                */
/*                                    Playback                                    */
/*                                                                                */
/**********************************************************************************/

const playback = createAudioPlayback({
  onAudio(audioData) {
    // Schedule the audio instead of writing directly
    scheduleAudio(audioData)
    audioData.close()
  },
  onEnd() {
    // Playback has reached the end of the media
    log('playback ended')
    isPlaying = false
    schedulingLoop.stop()
    ringBufferWriter?.setPlaying(false)
  },
})

/**********************************************************************************/
/*                                                                                */
/*                                     Methods                                    */
/*                                                                                */
/**********************************************************************************/

expose<AudioPlaybackWorkerMethods>({
  getBufferRange: playback.getBufferRange,
  getPerf: playback.getPerf,
  getState: playback.getState,
  resetPerf: playback.resetPerf,

  setRingBuffer(sampleBuffer, controlBuffer, sampleRate) {
    log('setRingBuffer', { targetSampleRate: sampleRate })
    ringBufferWriter = createRingBufferWriter(sampleBuffer, controlBuffer)
    targetSampleRate = sampleRate
  },

  async load(clipId) {
    log('load', { clipId })

    // Create OPFS source and load
    const source = await makeOPFSSource(clipId)
    return playback.load(source)
  },

  play(startTime, playbackSpeed = 1) {
    log('play', { startTime, playbackSpeed })

    // Update timing state
    playbackStartTime = performance.now()
    playbackStartMediaTime = startTime
    isPlaying = true

    // Set ring buffer to playing mode
    ringBufferWriter?.setPlaying(true)

    // Start the underlying playback (which will decode and call onAudio)
    playback.play(startTime, playbackSpeed)

    // Start scheduling loop
    schedulingLoop.start()
  },

  pause() {
    log('pause')

    // Save current position
    pausedMediaTime = getCurrentMediaTime()
    isPlaying = false

    // Stop ring buffer playback
    ringBufferWriter?.setPlaying(false)

    // Pause underlying playback
    playback.pause()

    // Stop scheduling loop
    schedulingLoop.stop()
  },

  async seek(time) {
    log('seek', { time })

    // Clear pending samples
    pendingSamples.length = 0

    // Clear ring buffer
    ringBufferWriter?.clear()

    // Update timing
    pausedMediaTime = time
    if (isPlaying) {
      playbackStartTime = performance.now()
      playbackStartMediaTime = time
    }

    // Seek underlying playback
    await playback.seek(time)
  },

  async getAudioAtTime(time) {
    const audioData = await playback.getAudioAtTime(time)
    return audioData ? transfer(audioData) : null
  },
})
