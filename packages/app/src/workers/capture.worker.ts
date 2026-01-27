/**
 * Capture Worker
 *
 * Captures video and audio frames from streams and forwards them to the muxer.
 * Handles worker-specific concerns:
 * - RPC exposure via @bigmistqke/rpc/messenger
 * - Worker-to-worker MessagePort connections for frame transfer to muxer
 */

import { expose, handle, rpc, type Handled, type RPC } from '@bigmistqke/rpc/messenger'
import { extractAudioChannels } from '@eddy/audio'
import type { AudioFrameData, VideoFrameData } from '@eddy/media'
import { debug } from '@eddy/utils'

const log = debug('capture.worker', false)

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

/** Methods returned by init() as a sub-proxy */
export interface CaptureMethods {
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

export interface CaptureWorkerMethods {
  /** Initialize with muxer port for forwarding frames, returns capture methods */
  init(port: MessagePort): Handled<CaptureMethods>
}

/** Methods exposed by muxer on the capture port */
interface MuxerPortMethods {
  addVideoFrame(data: VideoFrameData): void
  addAudioFrame(data: AudioFrameData): void
  captureEnded(frameCount: number): void
}

/**********************************************************************************/
/*                                                                                */
/*                                      Utils                                     */
/*                                                                                */
/**********************************************************************************/

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
  const sampleRate = audioData.sampleRate
  const data = extractAudioChannels(audioData)
  const timestamp = (audioData.timestamp - firstTimestamp) / 1_000_000
  audioData.close()

  return { data, sampleRate, timestamp }
}

/**********************************************************************************/
/*                                                                                */
/*                                    Expose                                      */
/*                                                                                */
/**********************************************************************************/

expose<CaptureWorkerMethods>({
  init(port) {
    port.start()
    const muxer = rpc<MuxerPortMethods>(port)
    log('received muxer port')

    // Session state
    let currentSessionId = 0
    let videoReader: ReadableStreamDefaultReader<VideoFrame> | null = null
    let audioReader: ReadableStreamDefaultReader<AudioData> | null = null

    return handle({
      async start(videoStream, audioStream) {
        // Increment session ID to invalidate any previous capture loops
        const sessionId = ++currentSessionId
        const isCurrentSession = () => sessionId === currentSessionId

        log('starting', { sessionId, hasAudio: !!audioStream })

        let firstVideoTimestamp: number | null = null
        let firstAudioTimestamp: number | null = null
        let videoFrameCount = 0

        // Start audio capture in parallel (fire and forget)
        let audioFrameCount = 0
        if (audioStream) {
          audioReader = audioStream.getReader()
          // Capture the reader reference for this session
          const myAudioReader = audioReader
          ;(async () => {
            try {
              while (isCurrentSession()) {
                const { done, value: audioData } = await myAudioReader.read()
                if (done || !audioData || !isCurrentSession()) break

                // Log first frame's audio format for debugging
                if (firstAudioTimestamp === null) {
                  firstAudioTimestamp = audioData.timestamp
                  log('first audio frame', {
                    sessionId,
                    format: audioData.format,
                    sampleRate: audioData.sampleRate,
                    numberOfChannels: audioData.numberOfChannels,
                    numberOfFrames: audioData.numberOfFrames,
                    timestamp: audioData.timestamp,
                  })
                }

                const frameData = audioDataToFrameData(audioData, firstAudioTimestamp)
                muxer.addAudioFrame(frameData)
                audioFrameCount++
              }
            } catch (err) {
              if (isCurrentSession()) {
                log('audio error', err)
              }
            }
            log('audio capture done', { sessionId, audioFrameCount })
          })()
        }

        // Video capture
        videoReader = videoStream.getReader()

        try {
          while (isCurrentSession()) {
            const { done, value: frame } = await videoReader.read()
            if (done || !frame || !isCurrentSession()) break

            // Use first frame's timestamp as reference
            if (firstVideoTimestamp === null) {
              firstVideoTimestamp = frame.timestamp
            }

            const timestamp = (frame.timestamp! - firstVideoTimestamp) / 1_000_000
            const data = await copyVideoFrameToBuffer(frame)
            muxer.addVideoFrame({ ...data, timestamp })
            videoFrameCount++
          }
        } catch (err) {
          if (isCurrentSession()) {
            log('video error', err)
            throw err
          }
        }

        // Only signal end if this session is still current
        if (isCurrentSession()) {
          muxer.captureEnded(videoFrameCount)
          log('done', { sessionId, videoFrameCount })
        }
      },

      stop() {
        // Increment session ID to invalidate current capture loops
        currentSessionId++
        videoReader?.cancel().catch(() => {})
        audioReader?.cancel().catch(() => {})
        log('stop', { newSessionId: currentSessionId })
      },
    } satisfies CaptureMethods)
  },
})
