/**
 * Worker Pool
 *
 * Generic pool of reusable Web Workers to avoid initialization overhead.
 * Workers are acquired, used, and released back to the pool.
 */

import { debug } from '@eddy/utils'

const log = debug('make-worker-pool', false)

export interface PooledWorker<T> {
  worker: Worker
  rpc: T
  inUse: boolean
}

export interface WorkerPool<T> {
  /** Acquire a worker from the pool (creates new if none available) */
  acquire(): PooledWorker<T>

  /** Release a worker back to the pool */
  release(worker: PooledWorker<T>): void

  /** Get current pool stats */
  stats(): { total: number; inUse: number; idle: number }

  /** Destroy all workers in the pool */
  destroy(): void
}

export interface WorkerPoolOptions<T> {
  /** Factory to create a new Worker instance */
  create: () => Worker

  /** Wrap worker with RPC interface */
  wrap: (worker: Worker) => T

  /** Reset worker state on release (keeps worker alive) */
  reset?: (rpc: T) => void | Promise<void>

  /** Maximum number of workers to keep in pool (default: 8) */
  maxSize?: number
}

/**
 * Create a generic worker pool
 */
export function makeWorkerPool<T>(options: WorkerPoolOptions<T>): WorkerPool<T> {
  const { create, wrap, reset, maxSize = 8 } = options

  const pool: PooledWorker<T>[] = []

  function createWorker(): PooledWorker<T> {
    log('creating new worker')
    const worker = create()
    const rpc = wrap(worker)

    return {
      worker,
      rpc,
      inUse: false,
    }
  }

  function acquire(): PooledWorker<T> {
    // Find an idle worker
    const idle = pool.find(pooledWorker => !pooledWorker.inUse)

    if (idle) {
      log('acquiring idle worker', { poolSize: pool.length })
      idle.inUse = true
      return idle
    }

    // Create new worker if under limit
    if (pool.length < maxSize) {
      const newWorker = createWorker()
      newWorker.inUse = true
      pool.push(newWorker)
      log('created new worker', { poolSize: pool.length })
      return newWorker
    }

    // Pool exhausted - create anyway but don't add to pool
    // This worker will be terminated on release
    log('pool exhausted, creating temporary worker')
    const tempWorker = createWorker()
    tempWorker.inUse = true
    return tempWorker
  }

  async function release(pooledWorker: PooledWorker<T>): Promise<void> {
    const inPool = pool.includes(pooledWorker)

    if (inPool) {
      // Reset worker state, keep worker alive for reuse
      await reset?.(pooledWorker.rpc)
      pooledWorker.inUse = false
      log('released worker to pool', { poolSize: pool.length })
    } else {
      pooledWorker.worker.terminate()
      log('terminated temporary worker')
    }
  }

  function stats() {
    const inUse = pool.filter(pooledWorker => pooledWorker.inUse).length
    return {
      total: pool.length,
      inUse,
      idle: pool.length - inUse,
    }
  }

  function destroy(): void {
    log('destroying pool', { size: pool.length })
    for (const pooledWorker of pool) {
      pooledWorker.worker.terminate()
    }
    pool.length = 0
  }

  return {
    acquire,
    release,
    stats,
    destroy,
  }
}
