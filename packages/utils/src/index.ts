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
    if ((ENABLED && enabled)) {
      console.log(`[${title}]`, ...args)
    }
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
