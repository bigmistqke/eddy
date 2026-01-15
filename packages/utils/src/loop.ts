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
export function createLoop(callback: (loop: Loop, timestamp: number) => void): Loop {
  let loopId: number | null = null

  function tick(timestamp: DOMHighResTimeStamp): void {
    callback(loop, timestamp)
    // Only continue if still running (callback might have called stop())
    if (loopId !== null) {
      loopId = requestAnimationFrame(tick)
    }
  }

  const loop: Loop = {
    get isRunning() {
      return loopId !== null
    },

    start() {
      if (loopId !== null) return
      loopId = requestAnimationFrame(tick)
    },

    stop() {
      if (loopId === null) return
      cancelAnimationFrame(loopId)
      loopId = null
    },
  }

  return loop
}
