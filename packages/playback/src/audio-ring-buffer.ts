/**
 * Lock-free ring buffer for audio samples using SharedArrayBuffer
 *
 * Structure:
 * - Uses SharedArrayBuffer for cross-thread access (main thread writes, audio worklet reads)
 * - Atomic read/write pointers for lock-free synchronization
 * - Stores interleaved stereo samples as Float32
 */

/** Control indices in the control buffer */
const WRITE_PTR = 0
const READ_PTR = 1
const CHANNELS = 2
const PLAYING = 3

export interface AudioRingBuffer {
  /** The SharedArrayBuffer containing audio samples */
  readonly sampleBuffer: SharedArrayBuffer
  /** The SharedArrayBuffer containing control data (pointers, state) */
  readonly controlBuffer: SharedArrayBuffer
  /** Number of channels */
  readonly channels: number
  /** Buffer capacity in frames (samples per channel) */
  readonly capacity: number

  /** Write samples to the buffer. Returns number of frames written. */
  write(samples: Float32Array[], frameCount: number): number

  /** Get available space in frames */
  availableWrite(): number

  /** Get available samples to read in frames */
  availableRead(): number

  /** Clear the buffer */
  clear(): void

  /** Set playing state */
  setPlaying(playing: boolean): void
}

/**
 * Create a ring buffer for audio samples
 * @param capacity - Buffer size in frames (samples per channel)
 * @param channels - Number of audio channels (default: 2 for stereo)
 */
export function createAudioRingBuffer(capacity: number, channels: number = 2): AudioRingBuffer {
  // Sample buffer: capacity * channels * 4 bytes per float
  const sampleBuffer = new SharedArrayBuffer(capacity * channels * Float32Array.BYTES_PER_ELEMENT)
  const samples = new Float32Array(sampleBuffer)

  // Control buffer: 4 int32 values (writePtr, readPtr, channels, playing)
  const controlBuffer = new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT)
  const control = new Int32Array(controlBuffer)

  // Initialize control values
  Atomics.store(control, WRITE_PTR, 0)
  Atomics.store(control, READ_PTR, 0)
  Atomics.store(control, CHANNELS, channels)
  Atomics.store(control, PLAYING, 0)

  return {
    sampleBuffer,
    controlBuffer,
    channels,
    capacity,

    write(channelData: Float32Array[], frameCount: number): number {
      const available = this.availableWrite()
      const toWrite = Math.min(frameCount, available)

      if (toWrite === 0) return 0

      const writePtr = Atomics.load(control, WRITE_PTR)

      // Write interleaved samples
      for (let frame = 0; frame < toWrite; frame++) {
        const bufferIndex = ((writePtr + frame) % capacity) * channels
        for (let ch = 0; ch < channels; ch++) {
          // If channelData has fewer channels, duplicate the last one
          const sourceChannel = Math.min(ch, channelData.length - 1)
          samples[bufferIndex + ch] = channelData[sourceChannel][frame] ?? 0
        }
      }

      // Update write pointer atomically
      Atomics.store(control, WRITE_PTR, (writePtr + toWrite) % capacity)

      return toWrite
    },

    availableWrite(): number {
      const writePtr = Atomics.load(control, WRITE_PTR)
      const readPtr = Atomics.load(control, READ_PTR)

      if (writePtr >= readPtr) {
        // Write is ahead of read: available = capacity - (write - read) - 1
        // -1 to distinguish full from empty
        return capacity - (writePtr - readPtr) - 1
      } else {
        // Read is ahead of write: available = read - write - 1
        return readPtr - writePtr - 1
      }
    },

    availableRead(): number {
      const writePtr = Atomics.load(control, WRITE_PTR)
      const readPtr = Atomics.load(control, READ_PTR)

      if (writePtr >= readPtr) {
        return writePtr - readPtr
      } else {
        return capacity - readPtr + writePtr
      }
    },

    clear(): void {
      Atomics.store(control, WRITE_PTR, 0)
      Atomics.store(control, READ_PTR, 0)
    },

    setPlaying(playing: boolean): void {
      Atomics.store(control, PLAYING, playing ? 1 : 0)
    },
  }
}

/**
 * Worklet-side ring buffer reader
 * This is used inside the AudioWorkletProcessor
 */
export function createRingBufferReader(
  sampleBuffer: SharedArrayBuffer,
  controlBuffer: SharedArrayBuffer,
) {
  const samples = new Float32Array(sampleBuffer)
  const control = new Int32Array(controlBuffer)
  const channels = Atomics.load(control, CHANNELS)
  const capacity = samples.length / channels

  return {
    /** Read samples into output buffers. Returns number of frames read. */
    read(outputs: Float32Array[], frameCount: number): number {
      const playing = Atomics.load(control, PLAYING)
      if (!playing) return 0

      const writePtr = Atomics.load(control, WRITE_PTR)
      const readPtr = Atomics.load(control, READ_PTR)

      // Calculate available
      let available: number
      if (writePtr >= readPtr) {
        available = writePtr - readPtr
      } else {
        available = capacity - readPtr + writePtr
      }

      const toRead = Math.min(frameCount, available)

      if (toRead === 0) return 0

      // Read interleaved samples into separate channel buffers
      for (let frame = 0; frame < toRead; frame++) {
        const bufferIndex = ((readPtr + frame) % capacity) * channels
        for (let ch = 0; ch < outputs.length; ch++) {
          // If buffer has fewer channels, use the last one
          const sourceChannel = Math.min(ch, channels - 1)
          outputs[ch][frame] = samples[bufferIndex + sourceChannel]
        }
      }

      // Update read pointer atomically
      Atomics.store(control, READ_PTR, (readPtr + toRead) % capacity)

      return toRead
    },

    /** Get available samples to read */
    availableRead(): number {
      const writePtr = Atomics.load(control, WRITE_PTR)
      const readPtr = Atomics.load(control, READ_PTR)

      if (writePtr >= readPtr) {
        return writePtr - readPtr
      } else {
        return capacity - readPtr + writePtr
      }
    },

    /** Check if playing */
    isPlaying(): boolean {
      return Atomics.load(control, PLAYING) === 1
    },
  }
}
