/**
 * Animation frame loop utility
 *
 * Encapsulates requestAnimationFrame loop management with proper cleanup.
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
  let animationFrameId: number | null = null

  function tick(): void {
    callback(loop)
    // Only continue if still running (callback might have called stop())
    if (animationFrameId !== null) {
      animationFrameId = requestAnimationFrame(tick)
    }
  }

  const loop: Loop = {
    get isRunning() {
      return animationFrameId !== null
    },

    start() {
      if (animationFrameId !== null) return
      animationFrameId = requestAnimationFrame(tick)
    },

    stop() {
      if (animationFrameId === null) return
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    },
  }

  return loop
}
