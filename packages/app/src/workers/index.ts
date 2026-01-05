/**
 * Worker RPC utilities
 *
 * Uses @bigmistqke/rpc/messenger for type-safe worker communication
 */

// Re-export types from worker files (import type ensures no code is bundled)
export type { DemuxWorkerMethods } from './demux.worker'
export type {
  RecordingStartConfig,
  RecordingResult,
  RecordingWorkerMethods,
} from './recording.worker'
export type { CompositorWorkerMethods } from './compositor.worker'
export type { CaptureWorkerMethods } from './debug-capture.worker'
export type { MuxerWorkerMethods, MuxerInitConfig, MuxerFrameData } from './debug-muxer.worker'

export * from './create-worker'
export * from './create-demuxer-worker'
export * from './create-recorder-worker'
export * from './create-compositor-worker'
