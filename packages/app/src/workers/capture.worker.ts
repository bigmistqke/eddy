import { expose, rpc } from '@bigmistqke/rpc/messenger'
import type { AudioFrameData, VideoFrameData } from '@eddy/codecs'
import { debug } from '@eddy/utils'

const log = debug('capture-worker', false)

export interface CaptureWorkerMethods {
  /** Set the muxer port for forwarding frames (called before start) */
  setMuxerPort(port: MessagePort): void

  /**
   * Start capturing frames from video and audio streams.
   * Frames are forwarded to the muxer via MessagePort.
   */
  start(
    videoStream: ReadableStream<VideoFrame>,
    audioStream?: ReadableStream<AudioData>,
  ): Promise<void>

  /** Stop capturing */
  stop(): void
}

/** Methods exposed by muxer on the capture port */
interface MuxerPortMethods {
  addVideoFrame(data: VideoFrameData): void
  addAudioFrame(data: AudioFrameData): void
  captureEnded(frameCount: number): void
}

let capturing = false
let videoReader: ReadableStreamDefaultReader<VideoFrame> | null = null
let audioReader: ReadableStreamDefaultReader<AudioData> | null = null
let muxer: ReturnType<typeof rpc<MuxerPortMethods>> | null = null

async function copyVideoFrameToBuffer(frame: VideoFrame): Promise<{
  buffer: ArrayBuffer
  format: VideoPixelFormat
  codedWidth: number
  codedHeight: number
}> {
  const format = frame.format!
  const codedWidth = frame.codedWidth
  const codedHeight = frame.codedHeight
  const buffer = new ArrayBuffer(frame.allocationSize())
  await frame.copyTo(buffer)
  frame.close()
  return { buffer, format, codedWidth, codedHeight }
}

/** Convert AudioData to AudioFrameData format expected by muxer */
function audioDataToFrameData(audioData: AudioData, firstTimestamp: number): AudioFrameData {
  const numberOfChannels = audioData.numberOfChannels
  const numberOfFrames = audioData.numberOfFrames
  const sampleRate = audioData.sampleRate

  // Extract each channel as Float32Array
  const data: Float32Array[] = []
  for (let channel = 0; channel < numberOfChannels; channel++) {
    const channelData = new Float32Array(numberOfFrames)
    audioData.copyTo(channelData, { planeIndex: channel })
    data.push(channelData)
  }

  const timestamp = (audioData.timestamp - firstTimestamp) / 1_000_000
  audioData.close()

  return { data, sampleRate, timestamp }
}

const methods: CaptureWorkerMethods = {
  setMuxerPort(port: MessagePort) {
    port.start()
    muxer = rpc<MuxerPortMethods>(port)
    log('received muxer port')
  },

  async start(videoStream: ReadableStream<VideoFrame>, audioStream?: ReadableStream<AudioData>) {
    if (!muxer) {
      throw new Error('No muxer - call setMuxerPort first')
    }

    log('starting', { hasAudio: !!audioStream })
    capturing = true

    let firstVideoTimestamp: number | null = null
    let firstAudioTimestamp: number | null = null
    let videoFrameCount = 0

    // Start audio capture in parallel (fire and forget)
    if (audioStream) {
      audioReader = audioStream.getReader()
      ;(async () => {
        try {
          while (capturing) {
            const { done, value: audioData } = await audioReader!.read()
            if (done || !audioData) break

            if (firstAudioTimestamp === null) {
              firstAudioTimestamp = audioData.timestamp
            }

            const frameData = audioDataToFrameData(audioData, firstAudioTimestamp)
            muxer!.addAudioFrame(frameData)
          }
        } catch (err) {
          log('audio error', err)
        }
        log('audio capture done')
      })()
    }

    // Video capture
    videoReader = videoStream.getReader()

    try {
      while (capturing) {
        const { done, value: frame } = await videoReader.read()
        if (done || !frame) break

        // Use first frame's timestamp as reference
        if (firstVideoTimestamp === null) {
          firstVideoTimestamp = frame.timestamp
        }

        const timestamp = (frame.timestamp - firstVideoTimestamp) / 1_000_000
        const data = await copyVideoFrameToBuffer(frame)
        muxer.addVideoFrame({ ...data, timestamp })
        videoFrameCount++
      }
    } catch (err) {
      log('video error', err)
      throw err
    }

    // Signal end of stream
    muxer.captureEnded(videoFrameCount)
    log('done', { videoFrameCount })
  },

  stop() {
    capturing = false
    videoReader?.cancel().catch(() => {})
    audioReader?.cancel().catch(() => {})
    log('stop')
  },
}

expose(methods)
