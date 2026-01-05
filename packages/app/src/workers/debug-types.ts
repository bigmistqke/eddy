/**
 * RPC type definitions for debug recording workers
 */

// ============================================================================
// Debug Capture Worker Types
// ============================================================================

export interface CaptureWorkerMethods {
  /** Set the muxer port for forwarding frames (called before start) */
  setMuxerPort(port: MessagePort): void

  /**
   * Start capturing frames from a video stream.
   * Frames are forwarded to the muxer via MessagePort.
   */
  start(readable: ReadableStream<VideoFrame>): Promise<void>

  /** Stop capturing */
  stop(): void
}

// ============================================================================
// Debug Muxer Worker Types
// ============================================================================

export interface MuxerInitConfig {
  format: VideoPixelFormat
  codedWidth: number
  codedHeight: number
}

export interface MuxerFrameData {
  buffer: ArrayBuffer
  format: VideoPixelFormat
  codedWidth: number
  codedHeight: number
  timestampSec: number
}

export interface MuxerWorkerMethods {
  /**
   * Set the capture port for receiving frames from capture worker.
   * Call this before recording.
   */
  setCapturePort(port: MessagePort): void

  /**
   * Pre-initialize the muxer (creates VP9 encoder).
   * Call this before recording to avoid startup delay.
   */
  preInit(): Promise<void>

  /**
   * Initialize with format info from first frame.
   * If preInit was called, this just stores the format.
   */
  init(config: MuxerInitConfig): Promise<void>

  /**
   * Add a frame to be encoded.
   * Frames are queued and processed as fast as possible.
   */
  addFrame(data: MuxerFrameData): void

  /**
   * Signal end of stream and finalize the output.
   * Returns the encoded WebM blob.
   */
  finalize(): Promise<{ blob: Blob; frameCount: number }>

  /** Reset state for next recording */
  reset(): void
}
