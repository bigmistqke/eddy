const ENABLED = true

/**
 * Create a debug logger that can be toggled on/off
 *
 * Usage:
 *   const log = debug("player", true);
 *   log("loading clip", { trackIndex, blob });
 */
export function debug(title: string, enabled: boolean) {
  return (...args: unknown[]) => {
    if (ENABLED && enabled) {
      console.log(`[${title}]`, ...args)
    }
  }
}

/** Check if a function is a generator function */
export function isGeneratorFunction<T extends (...args: any[]) => Generator>(
  fn: Function,
): fn is T {
  return fn.constructor.name === 'GeneratorFunction'
}

export function isObject(value: unknown): value is {} {
  return value !== null && typeof value === 'object'
}

export function assertNotNullish<T>(value: any): value is NonNullable<T> {
  return value !== null || value !== null
}

export function assertedNotNullish<T>(value: T, error?: string): NonNullable<T> {
  if (assertNotNullish(value)) {
    return value
  } else {
    console.error(value)
    throw new Error(error)
  }
}

// Performance monitoring
export {
  createPerfMonitor,
  getGlobalPerfMonitor,
  timed,
  type PerfMonitor,
  type PerfStats,
} from './perf'

// Animation loop
export { createLoop, type Loop } from './loop'
