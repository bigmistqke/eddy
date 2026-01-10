import type { DemuxedSample, VideoTrackInfo } from '@eddy/codecs'
import { createPerfMonitor, debug } from '@eddy/utils'
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

/** Worker state */
export type PlaybackState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'seeking'

/** Buffer configuration */
const BUFFER_AHEAD_FRAMES = 10
const BUFFER_AHEAD_SECONDS = 1.0
const BUFFER_MAX_FRAMES = 30

/** Frame output callback */
export type FrameCallback = (frame: VideoFrame | null) => void

/** Playback engine configuration */
export interface PlaybackEngineConfig {
  /** Callback when a new frame should be displayed */
  onFrame?: FrameCallback
  /** Enable debug logging */
  debug?: boolean
}

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

/**
 * PlaybackEngine handles demuxing, decoding, and frame buffering
 * for smooth video playback. It manages its own internal state and
 * timing, outputting VideoFrames via callback.
 */
export class PlaybackEngine {
  private perf = createPerfMonitor()

  // Demuxer state
  private input: Input | null = null
  private videoTrack: InputVideoTrack | null = null
  private videoSink: EncodedPacketSink | null = null
  private videoConfig: VideoDecoderConfig | null = null
  private duration = 0

  // Decoder state
  private decoder: VideoDecoder | null = null
  private decoderReady = false

  // Buffer state (ring buffer of decoded frames)
  private frameBuffer: FrameData[] = []
  private bufferPosition = 0 // Where we've decoded up to (seconds)
  private isBuffering = false // Lock to prevent concurrent buffer operations

  // Playback timing state
  private _isPlaying = false
  private startWallTime = 0 // performance.now() when play started
  private startMediaTime = 0 // media time when play started
  private speed = 1

  // State tracking
  private _state: PlaybackState = 'idle'
  private lastSentTimestamp: number | null = null

  // Animation frame ID
  private animationFrameId: number | null = null

  // Pending frame resolvers
  private pendingFrameResolvers: Array<{
    resolve: (frame: VideoFrame) => void
    reject: (error: Error) => void
  }> = []
  private pendingFrames: VideoFrame[] = []

  // Frame output
  private onFrame: FrameCallback | null = null

  constructor(config?: PlaybackEngineConfig) {
    this.onFrame = config?.onFrame ?? null
  }

  /** Current playback state */
  get state(): PlaybackState {
    return this._state
  }

  /** Whether playback is active */
  get isPlaying(): boolean {
    return this._isPlaying
  }

  /** Video duration in seconds */
  get videoDuration(): number {
    return this.duration
  }

  /** Set frame output callback */
  setFrameCallback(callback: FrameCallback | null): void {
    this.onFrame = callback
  }

  /**
   * Load video from buffer
   */
  async load(buffer: ArrayBuffer): Promise<{ duration: number; videoTrack: VideoTrackInfo | null }> {
    log('load', { size: buffer.byteLength })
    this._state = 'loading'

    // Clean up previous
    this.cleanup()

    // Create input from buffer
    const blob = new Blob([buffer])
    this.input = new Input({
      source: new BlobSource(blob),
      formats: ALL_FORMATS,
    })

    // Get video track
    const videoTracks = await this.input.getVideoTracks()
    this.videoTrack = videoTracks[0] ?? null

    let videoTrackInfo: VideoTrackInfo | null = null

    if (this.videoTrack) {
      this.videoSink = new EncodedPacketSink(this.videoTrack)
      this.videoConfig = await this.videoTrack.getDecoderConfig()
      this.duration = await this.videoTrack.computeDuration()

      const config = this.videoConfig
      log('videoTrack info', {
        id: this.videoTrack.id,
        codedWidth: this.videoTrack.codedWidth,
        codedHeight: this.videoTrack.codedHeight,
        duration: this.duration,
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
      const firstPacket = await this.videoSink.getFirstPacket()
      if (firstPacket) {
        log('first packet', {
          timestamp: firstPacket.timestamp,
          duration: firstPacket.duration,
          type: firstPacket.type,
          dataSize: firstPacket.data.byteLength,
        })
      }

      const codecString = await this.videoTrack.getCodecParameterString()
      videoTrackInfo = {
        id: this.videoTrack.id,
        index: 0,
        codec: codecString ?? 'unknown',
        width: this.videoTrack.codedWidth,
        height: this.videoTrack.codedHeight,
        duration: this.duration,
        timescale: 1,
        sampleCount: 0,
        bitrate: 0,
      }

      // Initialize decoder
      await this.initDecoder()
    }

    this._state = 'ready'
    log('load complete', { duration: this.duration, hasVideo: !!this.videoTrack })

    return { duration: this.duration, videoTrack: videoTrackInfo }
  }

  /**
   * Start playback from time at speed
   */
  play(startTime: number, playbackSpeed = 1): void {
    log('play', { startTime, playbackSpeed })

    this.startMediaTime = startTime
    this.startWallTime = performance.now()
    this.speed = playbackSpeed
    this._isPlaying = true
    this._state = 'playing'

    this.startStreamLoop()
  }

  /**
   * Pause playback
   */
  pause(): void {
    log('pause', { isPlaying: this._isPlaying })

    // Capture current position
    this.startMediaTime = this.getCurrentMediaTime()
    this._isPlaying = false
    this._state = 'paused'

    this.stopStreamLoop()
  }

  /**
   * Seek to time (buffers from keyframe)
   */
  async seek(time: number): Promise<void> {
    log('seek', { time, hasVideoSink: !!this.videoSink })
    const wasPlaying = this._isPlaying

    if (wasPlaying) {
      this._isPlaying = false
      this.stopStreamLoop()
    }

    this._state = 'seeking'
    await this.seekToTime(time)

    // Update position
    this.startMediaTime = time

    // Send frame at seek position
    this.sendFrame(time)

    if (wasPlaying) {
      this.startWallTime = performance.now()
      this._isPlaying = true
      this._state = 'playing'
      this.startStreamLoop()
    } else {
      this._state = 'paused'
    }
  }

  /**
   * Get current buffer range
   */
  getBufferRange(): { start: number; end: number } {
    if (this.frameBuffer.length === 0) {
      return { start: 0, end: 0 }
    }
    return {
      start: this.frameBuffer[0].timestamp / 1_000_000,
      end: this.frameBuffer[this.frameBuffer.length - 1].timestamp / 1_000_000,
    }
  }

  /**
   * Get performance stats
   */
  getPerf(): Record<string, { samples: number; avg: number; max: number; min: number; overThreshold: number }> {
    return this.perf.getAllStats()
  }

  /**
   * Reset performance stats
   */
  resetPerf(): void {
    this.perf.reset()
  }

  /**
   * Send current frame to compositor (for initial frame on handoff)
   */
  sendCurrentFrame(): void {
    if (this.frameBuffer.length > 0) {
      this.sendFrame(this.startMediaTime)
    }
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    log('destroy')

    this.stopStreamLoop()

    if (this.decoder && this.decoder.state !== 'closed') {
      this.decoder.close()
    }
    this.decoder = null

    if (this.input) {
      this.input[Symbol.dispose]?.()
      this.input = null
    }

    this.videoTrack = null
    this.videoSink = null
    this.videoConfig = null
    this.frameBuffer = []
    this._state = 'idle'
  }

  // Private methods

  private cleanup(): void {
    if (this.input) {
      this.input[Symbol.dispose]?.()
    }
    if (this.decoder && this.decoder.state !== 'closed') {
      this.decoder.close()
    }
    this.frameBuffer = []
    this.bufferPosition = 0
    this.decoderReady = false
  }

  private async initDecoder(): Promise<void> {
    if (!this.videoConfig) throw new Error('No video config')

    log('initDecoder', {
      codec: this.videoConfig.codec,
      codedWidth: this.videoConfig.codedWidth,
      codedHeight: this.videoConfig.codedHeight,
      hasDescription: !!this.videoConfig.description,
      descriptionLength:
        this.videoConfig.description instanceof ArrayBuffer
          ? this.videoConfig.description.byteLength
          : 'N/A',
    })

    // Check if decoder supports this config
    const support = await VideoDecoder.isConfigSupported(this.videoConfig)
    log('decoder config support', { supported: support.supported, config: support.config })

    if (!support.supported) {
      throw new Error(`Unsupported video config: ${this.videoConfig.codec}`)
    }

    // Clear pending state
    this.pendingFrameResolvers = []
    this.pendingFrames = []

    this.decoder = new VideoDecoder({
      output: (frame: VideoFrame) => {
        log('decoder output', { timestamp: frame.timestamp, duration: frame.duration })
        // If we have pending resolvers, resolve the first one
        const pending = this.pendingFrameResolvers.shift()
        if (pending) {
          pending.resolve(frame)
        } else {
          // Otherwise queue the frame
          this.pendingFrames.push(frame)
        }
      },
      error: error => {
        log('decoder error callback', { error, message: error.message, name: error.name })
        // Reject any pending promises
        const pending = this.pendingFrameResolvers.shift()
        if (pending) {
          pending.reject(error)
        }
      },
    })

    this.decoder.configure(this.videoConfig)
    this.decoderReady = false
  }

  private async decodeAndBuffer(sample: DemuxedSample): Promise<void> {
    this.perf.start('decode')
    if (!this.decoder || this.decoder.state === 'closed') {
      log('decodeAndBuffer: decoder not available', { decoderState: this.decoder?.state })
      this.perf.end('decode')
      return
    }

    // Skip delta frames if decoder not ready (need keyframe first)
    if (!this.decoderReady && !sample.isKeyframe) {
      log('skipping delta frame, decoder not ready')
      this.perf.end('decode')
      return
    }

    log('decodeAndBuffer', {
      pts: sample.pts,
      dts: sample.dts,
      duration: sample.duration,
      isKeyframe: sample.isKeyframe,
      dataSize: sample.data.byteLength,
      decoderState: this.decoder.state,
      decodeQueueSize: this.decoder.decodeQueueSize,
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
        if (this.pendingFrames.length > 0) {
          resolve(this.pendingFrames.shift()!)
          return
        }

        // Set up timeout
        const timeoutId = setTimeout(() => {
          // Remove this resolver from queue
          const index = this.pendingFrameResolvers.findIndex(p => p.resolve === resolve)
          if (index !== -1) this.pendingFrameResolvers.splice(index, 1)
          reject(new Error('Decode timeout'))
        }, 5000)

        this.pendingFrameResolvers.push({
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
      this.decoder.decode(chunk)

      // Wait for the frame
      const frame = await framePromise

      this.decoderReady = true
      log('decode success', { timestamp: frame.timestamp, duration: frame.duration })

      const data = await frameToData(frame, sample)

      // Insert in sorted order
      const insertIndex = this.frameBuffer.findIndex(f => f.timestamp > data.timestamp)
      if (insertIndex === -1) {
        this.frameBuffer.push(data)
      } else {
        this.frameBuffer.splice(insertIndex, 0, data)
      }

      this.bufferPosition = sample.pts + sample.duration

      // Trim old frames (keep max buffer size)
      while (this.frameBuffer.length > BUFFER_MAX_FRAMES) {
        this.frameBuffer.shift()
      }
      this.perf.end('decode')
    } catch (error) {
      this.perf.end('decode')
      log('decodeAndBuffer error', {
        error,
        errorMessage: error instanceof Error ? error.message : String(error),
        isKeyframe: sample.isKeyframe,
        pts: sample.pts,
        dataSize: sample.data.byteLength,
      })
      if (sample.isKeyframe) {
        this.decoderReady = false
      }
      // Re-throw to let caller handle
      throw error
    }
  }

  private async bufferAhead(fromTime: number): Promise<void> {
    if (!this.videoSink || !this.videoTrack) return
    if (this.isBuffering) return // Prevent concurrent buffering

    const targetEnd = Math.min(fromTime + BUFFER_AHEAD_SECONDS, this.duration)
    if (this.bufferPosition >= targetEnd) return

    this.isBuffering = true
    this.perf.start('bufferAhead')
    log('bufferAhead', { fromTime, targetEnd, bufferPosition: this.bufferPosition })

    try {
      // Get packet at current buffer position
      this.perf.start('demux')
      let packet = await this.videoSink.getPacket(this.bufferPosition)
      if (!packet) {
        packet = await this.videoSink.getFirstPacket()
      }
      this.perf.end('demux')

      let decoded = 0
      while (packet && packet.timestamp < targetEnd && decoded < BUFFER_AHEAD_FRAMES) {
        const sample = packetToSample(packet, this.videoTrack.id)
        try {
          await this.decodeAndBuffer(sample)
          decoded++
        } catch (error) {
          // Log but continue - try next packet
          log('bufferAhead: decode failed, skipping', { pts: sample.pts, error })
        }
        this.perf.start('demux')
        packet = await this.videoSink.getNextPacket(packet)
        this.perf.end('demux')
      }
    } catch (error) {
      log('bufferAhead error', { error })
    } finally {
      this.perf.end('bufferAhead')
      this.isBuffering = false
    }
  }

  private async seekToTime(time: number): Promise<void> {
    log('seekToTime: starting', { time })

    // Clear buffer
    this.frameBuffer = []
    this.lastSentTimestamp = null
    this.isBuffering = false

    // Clear pending frame state
    for (const frame of this.pendingFrames) {
      frame.close()
    }
    this.pendingFrames = []
    // Reject any waiting resolvers
    for (const pending of this.pendingFrameResolvers) {
      pending.reject(new Error('Seek interrupted'))
    }
    this.pendingFrameResolvers = []

    log('seekToTime: cleared pending state')

    // Reset decoder
    if (this.decoder && this.decoder.state !== 'closed') {
      this.decoder.reset()
      this.decoder.configure(this.videoConfig!)
    }
    this.decoderReady = false

    log('seekToTime: decoder reset')

    if (!this.videoSink) {
      log('seekToTime: no videoSink, returning')
      return
    }

    // Find keyframe before target
    log('seekToTime: getting keyframe packet')
    const keyPacket = await this.videoSink.getKeyPacket(time)
    this.bufferPosition = keyPacket?.timestamp ?? 0

    log('seekToTime: got keyframe, buffering ahead')

    // Buffer from keyframe to target + ahead
    await this.bufferAhead(this.bufferPosition)

    log('seekToTime: done')
  }

  private getCurrentMediaTime(): number {
    if (!this._isPlaying) return this.startMediaTime
    const elapsed = (performance.now() - this.startWallTime) / 1000
    return this.startMediaTime + elapsed * this.speed
  }

  private findFrameData(timeSeconds: number): FrameData | null {
    if (this.frameBuffer.length === 0) return null

    const timeUs = timeSeconds * 1_000_000
    let best: FrameData | null = null

    for (const frame of this.frameBuffer) {
      if (frame.timestamp <= timeUs) {
        best = frame
      } else {
        break
      }
    }

    return best ?? this.frameBuffer[0]
  }

  private sendFrame(time: number): void {
    if (!this.onFrame) return

    const frameData = this.findFrameData(time)
    if (!frameData) {
      // No frame available - clear if we had one
      if (this.lastSentTimestamp !== null) {
        this.lastSentTimestamp = null
        this.onFrame(null)
      }
      return
    }

    // Skip if same frame
    if (frameData.timestamp === this.lastSentTimestamp) {
      return
    }

    // Create VideoFrame and send to callback
    this.perf.start('transferFrame')
    const frame = dataToFrame(frameData)
    this.lastSentTimestamp = frameData.timestamp
    this.onFrame(frame)
    this.perf.end('transferFrame')
  }

  private trimOldFrames(currentTime: number): void {
    // Keep a small amount of past frames for seeking back slightly
    const keepPastSeconds = 0.5
    const minTimestamp = (currentTime - keepPastSeconds) * 1_000_000

    while (this.frameBuffer.length > 1 && this.frameBuffer[0].timestamp < minTimestamp) {
      this.frameBuffer.shift()
    }
  }

  private streamLoop = (): void => {
    if (!this._isPlaying) return

    const time = this.getCurrentMediaTime()

    // Check for end
    if (this.duration > 0 && time >= this.duration) {
      log('streamLoop: reached end', { time, duration: this.duration })
      this._isPlaying = false
      this._state = 'paused'
      return
    }

    // Send frame to callback
    this.sendFrame(time)

    // Trim frames behind us to free memory
    this.trimOldFrames(time)

    // Buffer ahead
    this.bufferAhead(time)

    // Continue loop
    this.animationFrameId = requestAnimationFrame(this.streamLoop)
  }

  private startStreamLoop(): void {
    if (this.animationFrameId !== null) return
    this.animationFrameId = requestAnimationFrame(this.streamLoop)
  }

  private stopStreamLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId)
      this.animationFrameId = null
    }
  }
}

/**
 * Create a new playback engine instance
 */
export function createPlaybackEngine(config?: PlaybackEngineConfig): PlaybackEngine {
  return new PlaybackEngine(config)
}
