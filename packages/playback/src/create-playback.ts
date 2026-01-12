import type { DemuxedSample, VideoTrackInfo } from '@eddy/codecs'
import { createLoop, createPerfMonitor, debug } from '@eddy/utils'
import {
  ALL_FORMATS,
  BlobSource,
  EncodedPacketSink,
  Input,
  type EncodedPacket,
  type InputVideoTrack,
} from 'mediabunny'
import { dataToFrame, frameToData, type FrameData } from './frame-utils'

const log = debug('playback:engine', false)

/** Buffer configuration */
const BUFFER_AHEAD_FRAMES = 10
const BUFFER_AHEAD_SECONDS = 1.0
const BUFFER_MAX_FRAMES = 30

/** Backpressure: skip delta frames if decoder queue exceeds this */
const DECODE_QUEUE_THRESHOLD = 3

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

/** Worker state */
export type PlaybackState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'seeking'

/** Frame output callback */
export type FrameCallback = (frame: VideoFrame | null) => void

/** Playback engine configuration */
export interface PlaybackConfig {
  /** Callback when a new frame should be displayed */
  onFrame?: FrameCallback
  /** External backpressure check - return true to skip delta frames */
  shouldSkipDeltaFrame?: () => boolean
  /** Enable debug logging */
  debug?: boolean
}

/**
 * PlaybackEngine handles demuxing, decoding, and frame buffering
 * for smooth video playback. It manages its own internal state and
 * timing, outputting VideoFrames via callback.
 */
export interface Playback {
  /** Whether playback is active */
  readonly isPlaying: boolean
  /** Video duration in seconds */
  readonly videoDuration: number
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
  getState(): PlaybackState
  /** Load video from buffer */
  load(buffer: ArrayBuffer): Promise<{
    duration: number
    videoTrack: VideoTrackInfo | null
  }>
  /** Pause playback */
  pause(): void
  /** Start playback from time at speed */
  play(startTime: number, playbackSpeed?: number): void
  /** Reset performance stats */
  resetPerf(): void
  /** Seek to time (buffers from keyframe) */
  seek(time: number): Promise<void>
  /** Send current frame to compositor (for initial frame on handoff) */
  sendCurrentFrame(): void
  /** Set frame output callback */
  setFrameCallback(callback: FrameCallback | null): void
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
    isKeyframe: packet.type === 'key',
    data: packet.data,
    size: packet.data.byteLength,
  }
}

/** Check if two VideoDecoderConfigs are equivalent (can reuse decoder) */
function configsMatch(a: VideoDecoderConfig | null, b: VideoDecoderConfig | null): boolean {
  if (!a || !b) return false
  return a.codec === b.codec && a.codedWidth === b.codedWidth && a.codedHeight === b.codedHeight
}

/**********************************************************************************/
/*                                                                                */
/*                                 Create Playback                                */
/*                                                                                */
/**********************************************************************************/

/**
 * Create a new playback engine instance
 */
export function createPlayback({ onFrame, shouldSkipDeltaFrame }: PlaybackConfig = {}): Playback {
  // return new PlaybackEngine(config)

  let perf = createPerfMonitor()

  // Demuxer state
  let input: Input | null = null
  let videoTrack: InputVideoTrack | null = null
  let videoSink: EncodedPacketSink | null = null
  let videoConfig: VideoDecoderConfig | null = null
  let duration = 0

  // Decoder state
  let decoder: VideoDecoder | null = null
  let decoderReady = false

  // Buffer state (ring buffer of decoded frames)
  let frameBuffer: FrameData[] = []
  let bufferPosition = 0 // Where we've decoded up to (seconds)
  let isBuffering = false // Lock to prevent concurrent buffer operations

  // Playback timing state
  // let _isPlaying = false
  let startWallTime = 0 // performance.now() when play started
  let startMediaTime = 0 // media time when play started
  let speed = 1

  // State tracking
  let _state: PlaybackState = 'idle'
  let lastSentTimestamp: number | null = null

  // Pending frame resolvers
  let pendingFrameResolvers: Array<{
    resolve: (frame: VideoFrame) => void
    reject: (error: Error) => void
  }> = []
  let pendingFrames: VideoFrame[] = []

  function sendFrame(time: number): void {
    if (!onFrame) return

    const frameData = findFrameData(time)
    if (!frameData) {
      // No frame available - clear if we had one
      if (lastSentTimestamp !== null) {
        lastSentTimestamp = null
        onFrame(null)
      }
      return
    }

    // Skip if same frame
    if (frameData.timestamp === lastSentTimestamp) {
      return
    }

    // Create VideoFrame and send to callback
    perf.start('transferFrame')
    const frame = dataToFrame(frameData)
    lastSentTimestamp = frameData.timestamp
    onFrame(frame)
    perf.end('transferFrame')
  }

  function findFrameData(timeSeconds: number): FrameData | null {
    if (frameBuffer.length === 0) return null

    const timeUs = timeSeconds * 1_000_000
    let best: FrameData | null = null

    for (const frame of frameBuffer) {
      if (frame.timestamp <= timeUs) {
        best = frame
      } else {
        break
      }
    }

    return best ?? frameBuffer[0]
  }

  async function initDecoder(): Promise<void> {
    if (!videoConfig) throw new Error('No video config')

    log('initDecoder', {
      codec: videoConfig.codec,
      codedWidth: videoConfig.codedWidth,
      codedHeight: videoConfig.codedHeight,
      hasDescription: !!videoConfig.description,
      descriptionLength:
        videoConfig.description instanceof ArrayBuffer ? videoConfig.description.byteLength : 'N/A',
    })

    // Check if decoder supports this config
    const support = await VideoDecoder.isConfigSupported(videoConfig)
    log('decoder config support', { supported: support.supported, config: support.config })

    if (!support.supported) {
      throw new Error(`Unsupported video config: ${videoConfig.codec}`)
    }

    // Clear pending state
    pendingFrameResolvers = []
    pendingFrames = []

    decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        log('decoder output', { timestamp: frame.timestamp, duration: frame.duration })
        // If we have pending resolvers, resolve the first one
        const pending = pendingFrameResolvers.shift()
        if (pending) {
          pending.resolve(frame)
        } else {
          // Otherwise queue the frame
          pendingFrames.push(frame)
        }
      },
      error: error => {
        log('decoder error callback', { error, message: error.message, name: error.name })
        // Reject any pending promises
        const pending = pendingFrameResolvers.shift()
        if (pending) {
          pending.reject(error)
        }
      },
    })

    decoder.configure(videoConfig)
    decoderReady = false
  }

  async function decodeAndBuffer(sample: DemuxedSample): Promise<void> {
    perf.start('decode')
    if (!decoder || decoder.state === 'closed') {
      log('decodeAndBuffer: decoder not available', { decoderState: decoder?.state })
      perf.end('decode')
      return
    }

    // Skip delta frames if decoder not ready (need keyframe first)
    if (!decoderReady && !sample.isKeyframe) {
      log('skipping delta frame, decoder not ready')
      perf.end('decode')
      return
    }

    // Skip delta frames if decoder queue is backed up (backpressure)
    if (decoder.decodeQueueSize > DECODE_QUEUE_THRESHOLD && !sample.isKeyframe) {
      log('skipping delta frame, decoder queue backed up', {
        decodeQueueSize: decoder.decodeQueueSize,
        threshold: DECODE_QUEUE_THRESHOLD,
      })
      perf.end('decode')
      return
    }

    // Skip delta frames if external scheduler signals backpressure (e.g., encoder busy)
    if (shouldSkipDeltaFrame?.() && !sample.isKeyframe) {
      log('skipping delta frame, external backpressure')
      perf.end('decode')
      return
    }

    log('decodeAndBuffer', {
      pts: sample.pts,
      dts: sample.dts,
      duration: sample.duration,
      isKeyframe: sample.isKeyframe,
      dataSize: sample.data.byteLength,
      decoderState: decoder.state,
      decodeQueueSize: decoder.decodeQueueSize,
    })

    const chunk = new EncodedVideoChunk({
      type: sample.isKeyframe ? 'key' : 'delta',
      timestamp: sample.pts * 1_000_000,
      duration: sample.duration * 1_000_000,
      data: sample.data,
    })

    try {
      // Set up promise BEFORE decode (to avoid race condition)
      const framePromise = new Promise<VideoFrame>((resolve, reject) => {
        // Check if we already have a frame queued
        if (pendingFrames.length > 0) {
          resolve(pendingFrames.shift()!)
          return
        }

        // Set up timeout
        const timeoutId = setTimeout(() => {
          // Remove this resolver from queue
          const index = pendingFrameResolvers.findIndex(p => p.resolve === resolve)
          if (index !== -1) pendingFrameResolvers.splice(index, 1)
          reject(new Error('Decode timeout'))
        }, 5000)

        pendingFrameResolvers.push({
          resolve: frame => {
            clearTimeout(timeoutId)
            resolve(frame)
          },
          reject: error => {
            clearTimeout(timeoutId)
            reject(error)
          },
        })
      })

      // Now decode the chunk
      decoder.decode(chunk)

      // Wait for the frame
      const frame = await framePromise

      decoderReady = true
      log('decode success', { timestamp: frame.timestamp, duration: frame.duration })

      const data = await frameToData(frame, sample)

      // Insert in sorted order
      const insertIndex = frameBuffer.findIndex(f => f.timestamp > data.timestamp)
      if (insertIndex === -1) {
        frameBuffer.push(data)
      } else {
        frameBuffer.splice(insertIndex, 0, data)
      }

      bufferPosition = sample.pts + sample.duration

      // Trim old frames (keep max buffer size)
      while (frameBuffer.length > BUFFER_MAX_FRAMES) {
        frameBuffer.shift()
      }
      perf.end('decode')
    } catch (error) {
      perf.end('decode')
      log('decodeAndBuffer error', {
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
        isKeyframe: sample.isKeyframe,
        pts: sample.pts,
        dataSize: sample.data.byteLength,
      })
      if (sample.isKeyframe) {
        decoderReady = false
      }
      // Re-throw to let caller handle
      throw error
    }
  }

  async function bufferAhead(fromTime: number): Promise<void> {
    if (!videoSink || !videoTrack) return
    if (isBuffering) return // Prevent concurrent buffering

    const targetEnd = Math.min(fromTime + BUFFER_AHEAD_SECONDS, duration)
    if (bufferPosition >= targetEnd) return

    isBuffering = true
    perf.start('bufferAhead')
    log('bufferAhead', { fromTime, targetEnd, bufferPosition: bufferPosition })

    try {
      // Get packet at current buffer position
      perf.start('demux')
      let packet = await videoSink.getPacket(bufferPosition)
      if (!packet) {
        packet = await videoSink.getFirstPacket()
      }
      perf.end('demux')

      let decoded = 0
      while (packet && packet.timestamp < targetEnd && decoded < BUFFER_AHEAD_FRAMES) {
        const sample = packetToSample(packet, videoTrack.id)
        try {
          await decodeAndBuffer(sample)
          decoded++
        } catch (error) {
          // Log but continue - try next packet
          log('bufferAhead: decode failed, skipping', { pts: sample.pts, error })
        }
        perf.start('demux')
        packet = await videoSink.getNextPacket(packet)
        perf.end('demux')
      }
    } catch (error) {
      log('bufferAhead error', { error })
    } finally {
      perf.end('bufferAhead')
      isBuffering = false
    }
  }

  async function seekToTime(time: number): Promise<void> {
    log('seekToTime: starting', { time })

    // Clear buffer
    frameBuffer = []
    lastSentTimestamp = null
    isBuffering = false

    // Clear pending frame state
    for (const frame of pendingFrames) {
      frame.close()
    }
    pendingFrames = []
    // Reject any waiting resolvers
    for (const pending of pendingFrameResolvers) {
      pending.reject(new Error('Seek interrupted'))
    }
    pendingFrameResolvers = []

    log('seekToTime: cleared pending state')

    // Reset decoder
    if (decoder && decoder.state !== 'closed') {
      decoder.reset()
      decoder.configure(videoConfig!)
    }
    decoderReady = false

    log('seekToTime: decoder reset')

    if (!videoSink) {
      log('seekToTime: no videoSink, returning')
      return
    }

    // Find keyframe before target
    log('seekToTime: getting keyframe packet')
    const keyPacket = await videoSink.getKeyPacket(time)
    bufferPosition = keyPacket?.timestamp ?? 0

    log('seekToTime: got keyframe, buffering ahead')

    // Buffer from keyframe to target + ahead
    await bufferAhead(bufferPosition)

    log('seekToTime: done')
  }

  function getCurrentMediaTime(): number {
    if (!streamLoop.isRunning) return startMediaTime
    const elapsed = (performance.now() - startWallTime) / 1000
    return startMediaTime + elapsed * speed
  }

  function trimOldFrames(currentTime: number): void {
    // Keep a small amount of past frames for seeking back slightly
    const keepPastSeconds = 0.5
    const minTimestamp = (currentTime - keepPastSeconds) * 1_000_000

    while (frameBuffer.length > 1 && frameBuffer[0].timestamp < minTimestamp) {
      frameBuffer.shift()
    }
  }

  const streamLoop = createLoop(loop => {
    const time = getCurrentMediaTime()

    // Check for end
    if (duration > 0 && time >= duration) {
      log('streamLoop: reached end', { time, duration: duration })
      _state = 'paused'
      loop.stop()
      return
    }

    // Send frame to callback
    sendFrame(time)

    // Trim frames behind us to free memory
    trimOldFrames(time)

    // Buffer ahead
    bufferAhead(time)
  })

  return {
    get isPlaying() {
      return streamLoop.isRunning
    },

    get videoDuration() {
      return duration
    },

    getState() {
      return _state
    },

    setFrameCallback(callback) {
      onFrame = callback ?? undefined
    },

    async load(buffer) {
      log('load', { size: buffer.byteLength })
      _state = 'loading'

      // Store previous config to check for reuse
      const previousConfig = videoConfig

      // Clean up previous input (but not decoder yet)
      if (input) {
        input[Symbol.dispose]?.()
        input = null
      }
      videoTrack = null
      videoSink = null
      frameBuffer = []
      bufferPosition = 0

      // Create input from buffer
      const blob = new Blob([buffer])
      input = new Input({
        source: new BlobSource(blob),
        formats: ALL_FORMATS,
      })

      // Get video track
      const videoTracks = await input.getVideoTracks()
      videoTrack = videoTracks[0] ?? null

      let videoTrackInfo: VideoTrackInfo | null = null

      if (videoTrack) {
        videoSink = new EncodedPacketSink(videoTrack)
        videoConfig = await videoTrack.getDecoderConfig()
        duration = await videoTrack.computeDuration()

        const config = videoConfig
        log('videoTrack info', {
          id: videoTrack.id,
          codedWidth: videoTrack.codedWidth,
          codedHeight: videoTrack.codedHeight,
          duration: duration,
          videoConfig: config
            ? {
                codec: config.codec,
                codedWidth: config.codedWidth,
                codedHeight: config.codedHeight,
                hasDescription: !!config.description,
              }
            : null,
        })

        // Log first packet to understand timestamp units
        const firstPacket = await videoSink.getFirstPacket()
        if (firstPacket) {
          log('first packet', {
            timestamp: firstPacket.timestamp,
            duration: firstPacket.duration,
            type: firstPacket.type,
            dataSize: firstPacket.data.byteLength,
          })
        }

        const codecString = await videoTrack.getCodecParameterString()
        videoTrackInfo = {
          id: videoTrack.id,
          index: 0,
          codec: codecString ?? 'unknown',
          width: videoTrack.codedWidth,
          height: videoTrack.codedHeight,
          duration: duration,
          timescale: 1,
          sampleCount: 0,
          bitrate: 0,
        }

        // Reuse decoder if config matches, otherwise create new
        if (decoder && decoder.state !== 'closed' && configsMatch(previousConfig, videoConfig)) {
          log('reusing decoder, config matches')
          decoder.reset()
          decoder.configure(videoConfig!)
          decoderReady = false
        } else {
          // Close old decoder if exists
          if (decoder && decoder.state !== 'closed') {
            decoder.close()
          }
          await initDecoder()
        }
      }

      _state = 'ready'
      log('load complete', { duration: duration, hasVideo: !!videoTrack })

      return { duration: duration, videoTrack: videoTrackInfo }
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

      // Capture current position
      startMediaTime = getCurrentMediaTime()
      _state = 'paused'

      streamLoop.stop()
    },

    async seek(time) {
      log('seek', { time, hasVideoSink: !!videoSink })
      const wasPlaying = streamLoop.isRunning

      if (wasPlaying) {
        streamLoop.stop()
      }

      _state = 'seeking'

      await seekToTime(time)

      // Update position
      startMediaTime = time

      // Send frame at seek position
      sendFrame(time)

      if (wasPlaying) {
        startWallTime = performance.now()
        _state = 'playing'
        streamLoop.start()
      } else {
        _state = 'paused'
      }
    },

    getBufferRange() {
      if (frameBuffer.length === 0) {
        return { start: 0, end: 0 }
      }
      return {
        start: frameBuffer[0].timestamp / 1_000_000,
        end: frameBuffer[frameBuffer.length - 1].timestamp / 1_000_000,
      }
    },

    getPerf() {
      return perf.getAllStats()
    },

    resetPerf(): void {
      perf.reset()
    },

    sendCurrentFrame(): void {
      if (frameBuffer.length > 0) {
        sendFrame(startMediaTime)
      }
    },
  } satisfies Playback
}
