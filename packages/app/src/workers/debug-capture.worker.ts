/**
 * Capture Worker: Reads VideoFrames from camera stream, copies to ArrayBuffer, transfers to muxer.
 *
 * This worker's only job is to capture frames as fast as possible and release
 * VideoFrame hardware resources immediately. All heavy processing happens in the muxer worker.
 */

interface CaptureStartMessage {
  type: 'start'
  readable: ReadableStream<VideoFrame>
  muxerPort: MessagePort
}

interface CaptureStopMessage {
  type: 'stop'
}

type CaptureMessage = CaptureStartMessage | CaptureStopMessage

let capturing = false
let reader: ReadableStreamDefaultReader<VideoFrame> | null = null

self.onmessage = async (e: MessageEvent<CaptureMessage>) => {
  const msg = e.data

  if (msg.type === 'start') {
    capturing = true
    const { readable, muxerPort } = msg
    reader = readable.getReader()

    let firstTimestamp: number | null = null
    let frameCount = 0

    // Wait for muxer ready signal
    const waitForMuxerReady = (): Promise<void> => {
      return new Promise(resolve => {
        const handler = (ev: MessageEvent) => {
          if (ev.data.type === 'ready') {
            muxerPort.removeEventListener('message', handler)
            resolve()
          }
        }
        muxerPort.addEventListener('message', handler)
        muxerPort.start()
      })
    }

    try {
      // Read first frame to get format info
      const { done: firstDone, value: firstFrame } = await reader.read()
      if (firstDone || !firstFrame) {
        self.postMessage({ type: 'error', error: 'No frames available' })
        return
      }

      firstTimestamp = firstFrame.timestamp

      // Send format info to muxer and wait for ready
      muxerPort.postMessage({
        type: 'init',
        format: firstFrame.format,
        codedWidth: firstFrame.codedWidth,
        codedHeight: firstFrame.codedHeight,
      })

      self.postMessage({ type: 'waiting', message: 'Waiting for muxer initialization...' })

      // Close the init frame - we only used it for format detection
      const format = firstFrame.format!
      const codedWidth = firstFrame.codedWidth
      const codedHeight = firstFrame.codedHeight
      firstFrame.close()

      await waitForMuxerReady()
      self.postMessage({ type: 'capturing', message: 'Muxer ready, capturing frames' })

      // Reset timestamp base to first frame AFTER muxer is ready
      firstTimestamp = null

      // Continue with remaining frames
      while (capturing) {
        const { done, value: frame } = await reader.read()
        if (done || !frame) break

        // Set timestamp base from first actual frame
        if (firstTimestamp === null) {
          firstTimestamp = frame.timestamp
        }

        const timestampSec = (frame.timestamp - firstTimestamp) / 1_000_000
        const format = frame.format!
        const codedWidth = frame.codedWidth
        const codedHeight = frame.codedHeight

        // Copy to ArrayBuffer immediately, then close to release hardware resource
        const buffer = new ArrayBuffer(frame.allocationSize())
        await frame.copyTo(buffer)
        frame.close()

        // Transfer buffer to muxer worker (zero-copy)
        muxerPort.postMessage(
          {
            type: 'frame',
            buffer,
            format,
            codedWidth,
            codedHeight,
            timestampSec,
          },
          [buffer]
        )

        frameCount++
      }
    } catch (err) {
      self.postMessage({ type: 'error', error: String(err) })
    }

    // Signal end of stream
    muxerPort.postMessage({ type: 'end', frameCount })
    self.postMessage({ type: 'done', frameCount })
  }

  if (msg.type === 'stop') {
    capturing = false
    reader?.cancel().catch(() => {})
  }
}
