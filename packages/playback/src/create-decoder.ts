import type { DemuxedSample } from '@eddy/codecs'
import { debug } from '@eddy/utils'

const log = debug('playback:create-decoder', false)

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

/** Result of a decode operation */
export type DecodeResult =
  | { type: 'frame'; frame: VideoFrame }
  | { type: 'skipped'; reason: 'not-ready' | 'backpressure' | 'external' }
  | { type: 'needs-keyframe'; time: number }

/** Configuration for managed decoder */
export interface DecoderConfig {
  /** Video decoder configuration */
  videoConfig: VideoDecoderConfig
  /** Backpressure threshold for decode queue */
  queueThreshold?: number
  /** External backpressure check */
  shouldSkipDeltaFrame?: () => boolean
}

/** Managed video decoder with automatic recovery */
export interface Decoder {
  /** Decode a sample - returns sync if frame ready, Promise if waiting */
  decode(sample: DemuxedSample): DecodeResult | Promise<DecodeResult>
  /** Reset decoder state (for seeking) */
  reset(): void
  /** Close decoder and release resources */
  close(): void
  /** Whether decoder has successfully decoded a keyframe */
  readonly isReady: boolean
  /** Current decoder state */
  readonly state: 'unconfigured' | 'configured' | 'closed' | 'none'
}

/**********************************************************************************/
/*                                                                                */
/*                                 Create Decoder                                 */
/*                                                                                */
/**********************************************************************************/

/**
 * Create a managed video decoder with automatic error recovery.
 *
 * Handles:
 * - Decoder initialization and configuration
 * - Automatic reinitialization on decoder errors
 * - Keyframe requirement tracking
 * - Backpressure-based frame skipping
 * - Promise-based frame output
 */
export function createDecoder({
  videoConfig,
  queueThreshold = 3,
  shouldSkipDeltaFrame,
}: DecoderConfig): Decoder {
  let decoder: VideoDecoder | null = null
  let isReady = false
  let pendingRecoveryTime: number | null = null

  // Promise-based frame handling
  let pendingResolvers: Array<{
    resolve: (frame: VideoFrame) => void
    reject: (error: Error) => void
  }> = []
  let pendingFrames: VideoFrame[] = []

  function init(): void {
    log('init', {
      codec: videoConfig.codec,
      codedWidth: videoConfig.codedWidth,
      codedHeight: videoConfig.codedHeight,
    })

    // Clear pending state
    pendingResolvers = []
    pendingFrames = []
    pendingRecoveryTime = null

    decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        log('output', { timestamp: frame.timestamp, duration: frame.duration })
        const pending = pendingResolvers.shift()
        if (pending) {
          pending.resolve(frame)
        } else {
          pendingFrames.push(frame)
        }
      },
      error: (error: DOMException) => {
        console.error('[playback:decoder] error callback - DECODER WILL CLOSE', {
          message: error.message,
          name: error.name,
        })
        const pending = pendingResolvers.shift()
        if (pending) {
          pending.reject(error)
        }
      },
    })

    decoder.configure(videoConfig)
    isReady = false
  }

  function waitForFrame(): Promise<VideoFrame> {
    // Check if we already have a frame queued
    if (pendingFrames.length > 0) {
      return Promise.resolve(pendingFrames.shift()!)
    }

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const index = pendingResolvers.findIndex(p => p.resolve === wrappedResolve)
        if (index !== -1) pendingResolvers.splice(index, 1)
        reject(new Error('Decode timeout'))
      }, 5000)

      const wrappedResolve = (frame: VideoFrame) => {
        clearTimeout(timeoutId)
        resolve(frame)
      }
      const wrappedReject = (error: Error) => {
        clearTimeout(timeoutId)
        reject(error)
      }

      pendingResolvers.push({ resolve: wrappedResolve, reject: wrappedReject })
    })
  }

  // Initialize on creation
  init()

  return {
    get isReady() {
      return isReady
    },

    get state() {
      return decoder?.state ?? 'none'
    },

    decode(sample): DecodeResult | Promise<DecodeResult> {
      // Check if recovery is pending from previous error
      if (pendingRecoveryTime !== null) {
        const time = pendingRecoveryTime
        pendingRecoveryTime = null
        log('returning pending recovery request', { time })
        return { type: 'needs-keyframe', time }
      }

      // Check decoder state - reinitialize if closed
      if (!decoder || decoder.state === 'closed') {
        log('decoder closed, reinitializing')
        init()
      }

      // Skip delta frames if decoder not ready (need keyframe first)
      if (!isReady && !sample.isKeyframe) {
        log('skipping delta frame, decoder not ready')
        return { type: 'skipped', reason: 'not-ready' }
      }

      // Skip delta frames if decoder queue is backed up
      if (decoder!.decodeQueueSize > queueThreshold && !sample.isKeyframe) {
        log('skipping delta frame, backpressure', { queueSize: decoder!.decodeQueueSize })
        return { type: 'skipped', reason: 'backpressure' }
      }

      // Skip delta frames if external backpressure
      if (shouldSkipDeltaFrame?.() && !sample.isKeyframe) {
        log('skipping delta frame, external backpressure')
        return { type: 'skipped', reason: 'external' }
      }

      // Create encoded chunk
      const chunk = new EncodedVideoChunk({
        type: sample.isKeyframe ? 'key' : 'delta',
        timestamp: sample.pts * 1_000_000,
        duration: sample.duration * 1_000_000,
        data: sample.data,
      })

      // Queue decode
      decoder!.decode(chunk)

      // Check if frame is already available (sync path)
      if (pendingFrames.length > 0) {
        const frame = pendingFrames.shift()!
        isReady = true
        log('decode success (sync)', { timestamp: frame.timestamp })
        return { type: 'frame', frame }
      }

      // Frame not ready yet - return promise (async path)
      return waitForFrame()
        .then(frame => {
          isReady = true
          log('decode success (async)', { timestamp: frame.timestamp })
          return { type: 'frame', frame } as DecodeResult
        })
        .catch(error => {
          console.error('[playback:decoder] decode error', {
            error,
            isKeyframe: sample.isKeyframe,
            pts: sample.pts,
            decoderState: decoder?.state,
          })

          if (sample.isKeyframe) {
            isReady = false
          }

          // If decoder closed due to error, signal recovery needed
          if (decoder?.state === 'closed') {
            pendingRecoveryTime = sample.pts
            log('decoder closed, will request keyframe recovery', { pts: sample.pts })
            init()
            return { type: 'needs-keyframe', time: sample.pts } as DecodeResult
          }

          // For other errors, skip
          return { type: 'skipped', reason: 'not-ready' } as DecodeResult
        })
    },

    reset() {
      log('reset')
      if (decoder && decoder.state !== 'closed') {
        decoder.reset()
        decoder.configure(videoConfig)
      }
      isReady = false
      pendingRecoveryTime = null

      // Clear pending frames
      for (const frame of pendingFrames) {
        frame.close()
      }
      pendingFrames = []

      // Reject pending resolvers
      for (const pending of pendingResolvers) {
        pending.reject(new Error('Decoder reset'))
      }
      pendingResolvers = []
    },

    close() {
      log('close')
      if (decoder && decoder.state !== 'closed') {
        decoder.close()
      }
      decoder = null
      isReady = false
      pendingRecoveryTime = null

      // Clean up pending state
      for (const frame of pendingFrames) {
        frame.close()
      }
      pendingFrames = []
      pendingResolvers = []
    },
  }
}
