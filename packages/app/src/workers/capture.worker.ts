/**
 * Capture Worker
 *
 * Reads VideoFrames and AudioData from camera/mic streams, copies to ArrayBuffer, transfers to muxer.
 * Designed to release hardware resources immediately.
 *
 * Communication:
 * - Main thread: RPC via @bigmistqke/rpc (setMuxerPort, start, stop)
 * - Muxer worker: RPC via @bigmistqke/rpc on transferred MessagePort
 */

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
function audioDataToFrameData(
  audioData: AudioData,
  firstTimestamp: number,
): AudioFrameData {
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

  async start(
    videoStream: ReadableStream<VideoFrame>,
    audioStream?: ReadableStream<AudioData>,
  ) {
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
      // Read first frame
      const { done: done1, value: frame1 } = await videoReader.read()
      if (done1 || !frame1) {
        throw new Error('No frames available')
      }

      // Read second frame to check for staleness
      const { done: done2, value: frame2 } = await videoReader.read()
      if (done2 || !frame2) {
        // Only got one frame, use it
        firstVideoTimestamp = frame1.timestamp
        const data = await copyVideoFrameToBuffer(frame1)
        muxer.addVideoFrame({ ...data, timestamp: 0 })
        videoFrameCount++
      } else {
        // Check gap between frame1 and frame2
        const gap = (frame2.timestamp - frame1.timestamp) / 1_000_000

        if (gap > 0.5) {
          // Frame1 is stale - discard it, use frame2 as first
          log('discarding stale frame', { gap: gap.toFixed(3) })
          frame1.close()
          firstVideoTimestamp = frame2.timestamp
          const data = await copyVideoFrameToBuffer(frame2)
          muxer.addVideoFrame({ ...data, timestamp: 0 })
          videoFrameCount++
        } else {
          // Frame1 is valid - use both
          firstVideoTimestamp = frame1.timestamp
          const data1 = await copyVideoFrameToBuffer(frame1)
          muxer.addVideoFrame({ ...data1, timestamp: 0 })
          videoFrameCount++

          const timestamp2 = (frame2.timestamp - firstVideoTimestamp) / 1_000_000
          const data2 = await copyVideoFrameToBuffer(frame2)
          muxer.addVideoFrame({ ...data2, timestamp: timestamp2 })
          videoFrameCount++
        }
      }

      // Continue with remaining frames
      while (capturing) {
        const { done, value: frame } = await videoReader.read()
        if (done || !frame) break

        const timestamp = (frame.timestamp - firstVideoTimestamp!) / 1_000_000
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
