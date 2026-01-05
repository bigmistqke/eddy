/**
 * Utilities for creating worker RPC clients
 */

import { rpc } from '@bigmistqke/rpc/messenger'
import type { CompositorWorkerMethods } from './compositor.worker'
import type { CaptureWorkerMethods } from './debug-capture.worker'
import type { MuxerWorkerMethods } from './debug-muxer.worker'
import type { DemuxWorkerMethods } from './demux.worker'
import type { RecordingWorkerMethods } from './recording.worker'

// Import workers as URLs for Vite
import CompositorWorkerUrl from './compositor.worker.ts?worker&url'
import DebugCaptureWorkerUrl from './debug-capture.worker.ts?worker&url'
import DebugMuxerWorkerUrl from './debug-muxer.worker.ts?worker&url'
import DemuxWorkerUrl from './demux.worker.ts?worker&url'
import RecordingWorkerUrl from './recording.worker.ts?worker&url'

/** RPC wrapper type - all methods return Promises */
type RpcMethods<T extends object> = {
  [K in keyof T]: T[K] extends (...args: infer A) => infer R
    ? (...args: A) => Promise<Awaited<R>>
    : T[K]
}

export interface WorkerHandle<T extends object> {
  /** RPC proxy to call worker methods */
  rpc: RpcMethods<T>
  /** The underlying Worker instance */
  worker: Worker
  /** Terminate the worker */
  terminate(): void
}

function createWorkerHandle<T extends object>(url: string): WorkerHandle<T> {
  const worker = new Worker(url, { type: 'module' })
  const proxy = rpc<T>(worker)

  return {
    rpc: proxy as RpcMethods<T>,
    worker,
    terminate() {
      worker.terminate()
    },
  }
}

/** Create a demux worker */
export function createDemuxWorker(): WorkerHandle<DemuxWorkerMethods> {
  return createWorkerHandle<DemuxWorkerMethods>(DemuxWorkerUrl)
}

/** Create a recording worker */
export function createRecordingWorker(): WorkerHandle<RecordingWorkerMethods> {
  return createWorkerHandle<RecordingWorkerMethods>(RecordingWorkerUrl)
}

/** Create a compositor worker */
export function createCompositorWorker(): WorkerHandle<CompositorWorkerMethods> {
  return createWorkerHandle<CompositorWorkerMethods>(CompositorWorkerUrl)
}

/** Create a debug capture worker */
export function createDebugCaptureWorker(): WorkerHandle<CaptureWorkerMethods> {
  return createWorkerHandle<CaptureWorkerMethods>(DebugCaptureWorkerUrl)
}

/** Create a debug muxer worker */
export function createDebugMuxerWorker(): WorkerHandle<MuxerWorkerMethods> {
  return createWorkerHandle<MuxerWorkerMethods>(DebugMuxerWorkerUrl)
}
