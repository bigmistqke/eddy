/**
 * Worker-based demuxer that provides the same Demuxer interface
 * but runs demuxing in a Web Worker for better performance.
 */

import type { Demuxer, DemuxerInfo } from '@eddy/codecs'
import { createDemuxWorker, type WorkerHandle, type DemuxWorkerMethods } from './index'

export interface WorkerDemuxer extends Demuxer {
  /** The underlying worker handle */
  readonly workerHandle: WorkerHandle<DemuxWorkerMethods>
}

/**
 * Create a demuxer that runs in a Web Worker.
 * Provides the same interface as createDemuxer from @eddy/codecs.
 */
export async function createDemuxerWorker(source: ArrayBuffer | Blob): Promise<WorkerDemuxer> {
  const handle = createDemuxWorker()

  // Convert Blob to ArrayBuffer if needed
  const buffer = source instanceof Blob ? await source.arrayBuffer() : source

  // Initialize the worker with the buffer
  const info = await handle.rpc.init(buffer)

  return {
    info,
    workerHandle: handle,

    async getVideoConfig() {
      return handle.rpc.getVideoConfig()
    },

    async getAudioConfig() {
      return handle.rpc.getAudioConfig()
    },

    async getSamples(trackId: number, startTime: number, endTime: number) {
      return handle.rpc.getSamples(trackId, startTime, endTime)
    },

    async getAllSamples(trackId: number) {
      return handle.rpc.getAllSamples(trackId)
    },

    async getKeyframeBefore(trackId: number, time: number) {
      return handle.rpc.getKeyframeBefore(trackId, time)
    },

    destroy() {
      handle.rpc.destroy()
      handle.terminate()
    },
  }
}
