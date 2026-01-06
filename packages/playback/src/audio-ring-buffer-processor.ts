import { expose } from '@bigmistqke/rpc/messenger'

const WRITE_PTR = 0
const READ_PTR = 1
const CHANNELS = 2
const PLAYING = 3

export interface RingBufferProcessorMethods {
  init(sampleBuffer: SharedArrayBuffer, controlBuffer: SharedArrayBuffer): void
}

class RingBufferProcessor extends AudioWorkletProcessor {
  samples: null | Float32Array
  control: null | Int32Array
  capacity: number
  channels: number

  constructor() {
    super()
    this.samples = null
    this.control = null
    this.capacity = 0
    this.channels = 2

    expose<RingBufferProcessorMethods>(
      {
        init: (sampleBuffer, controlBuffer) => {
          this.samples = new Float32Array(sampleBuffer)
          this.control = new Int32Array(controlBuffer)
          this.channels = Atomics.load(this.control, CHANNELS)
          this.capacity = this.samples.length / this.channels
        },
      },
      { to: this.port },
    )
  }

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean {
    const output = outputs[0]
    if (!output || output.length === 0) return true
    if (!this.samples || !this.control) return true

    const playing = Atomics.load(this.control, PLAYING)
    if (!playing) {
      // Output silence when not playing
      for (const channel of output) {
        channel.fill(0)
      }
      return true
    }

    const frameCount = output[0].length
    const writePtr = Atomics.load(this.control, WRITE_PTR)
    const readPtr = Atomics.load(this.control, READ_PTR)

    // Calculate available samples
    let available
    if (writePtr >= readPtr) {
      available = writePtr - readPtr
    } else {
      available = this.capacity - readPtr + writePtr
    }

    const toRead = Math.min(frameCount, available)

    // Read samples from ring buffer
    for (let frame = 0; frame < toRead; frame++) {
      const bufferIndex = ((readPtr + frame) % this.capacity) * this.channels
      for (let ch = 0; ch < output.length; ch++) {
        const sourceChannel = Math.min(ch, this.channels - 1)
        output[ch][frame] = this.samples[bufferIndex + sourceChannel]
      }
    }

    // Fill remaining with silence if underrun
    if (toRead < frameCount) {
      for (let frame = toRead; frame < frameCount; frame++) {
        for (const channel of output) {
          channel[frame] = 0
        }
      }
    }

    // Update read pointer
    if (toRead > 0) {
      Atomics.store(this.control, READ_PTR, (readPtr + toRead) % this.capacity)
    }

    return true
  }
}

registerProcessor('ring-buffer-processor', RingBufferProcessor)
