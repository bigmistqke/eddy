/**
 * Animation frame loop utility
 *
 * Encapsulates requestAnimationFrame loop management with proper cleanup.
 * Falls back to setInterval in workers where requestAnimationFrame isn't available.
 */

export interface Loop {
  /** Whether the loop is currently running */
  readonly isRunning: boolean
  /** Start the loop (no-op if already running) */
  start(): void
  /** Stop the loop (no-op if already stopped) */
  stop(): void
}

// Check if we're in a worker (no requestAnimationFrame)
const isWorker = typeof requestAnimationFrame === 'undefined'

// ~60fps interval for workers
const WORKER_INTERVAL_MS = 16

/**
 * Create an animation frame loop.
 *
 * Uses requestAnimationFrame on main thread, setInterval in workers.
 *
 * @param callback - Called every frame while running. Receives the loop instance
 *                   so it can call loop.stop() to self-terminate.
 *
 * @example
 * ```ts
 * const loop = createLoop((loop) => {
 *   const time = getCurrentTime()
 *   if (time >= duration) {
 *     loop.stop()
 *     return
 *   }
 *   render(time)
 * })
 *
 * loop.start()
 * // later...
 * loop.stop()
 * ```
 */
export function createLoop(callback: (loop: Loop) => void): Loop {
  let loopId: number | null = null

  function tick(): void {
    callback(loop)
    // Only continue if still running (callback might have called stop())
    if (loopId !== null && !isWorker) {
      loopId = requestAnimationFrame(tick)
    }
  }

  const loop: Loop = {
    get isRunning() {
      return loopId !== null
    },

    start() {
      if (loopId !== null) return
      if (isWorker) {
        loopId = setInterval(() => callback(loop), WORKER_INTERVAL_MS) as unknown as number
      } else {
        loopId = requestAnimationFrame(tick)
      }
    },

    stop() {
      if (loopId === null) return
      if (isWorker) {
        clearInterval(loopId)
      } else {
        cancelAnimationFrame(loopId)
      }
      loopId = null
    },
  }

  return loop
}
