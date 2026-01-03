/**
 * Performance monitoring utilities for identifying bottlenecks
 */

export interface PerfStats {
  /** Number of samples collected */
  samples: number
  /** Average duration in ms */
  avg: number
  /** Maximum duration in ms */
  max: number
  /** Minimum duration in ms */
  min: number
  /** Number of times duration exceeded threshold */
  overThreshold: number
}

export interface PerfMonitor {
  /** Start timing an operation */
  start(label: string): void
  /** End timing and record the duration */
  end(label: string): void
  /** Record a single value (for non-timing metrics like cache hits) */
  record(label: string, value: number): void
  /** Increment a counter */
  increment(label: string): void
  /** Get a counter value */
  getCounter(label: string): number
  /** Get all counters */
  getCounters(): Record<string, number>
  /** Get stats for a label */
  getStats(label: string): PerfStats | null
  /** Get all stats */
  getAllStats(): Record<string, PerfStats>
  /** Reset all stats */
  reset(): void
  /** Log summary to console */
  logSummary(): void
  /** Enable/disable monitoring */
  enabled: boolean
}

interface Timing {
  startTime: number
  values: number[]
  overThreshold: number
}

/**
 * Create a performance monitor
 *
 * @param threshold - Duration threshold in ms to flag as slow (default: 16.67ms = 60fps frame budget)
 * @param maxSamples - Maximum samples to keep per label (default: 1000)
 */
export function createPerfMonitor(threshold: number = 16.67, maxSamples: number = 1000): PerfMonitor {
  const timings = new Map<string, Timing>()
  const counters = new Map<string, number>()
  let enabled = true

  const getOrCreateTiming = (label: string): Timing => {
    let timing = timings.get(label)
    if (!timing) {
      timing = { startTime: 0, values: [], overThreshold: 0 }
      timings.set(label, timing)
    }
    return timing
  }

  return {
    get enabled() {
      return enabled
    },
    set enabled(value: boolean) {
      enabled = value
    },

    start(label: string) {
      if (!enabled) return
      const timing = getOrCreateTiming(label)
      timing.startTime = performance.now()
    },

    end(label: string) {
      if (!enabled) return
      const timing = timings.get(label)
      if (!timing || timing.startTime === 0) return

      const duration = performance.now() - timing.startTime
      timing.values.push(duration)
      if (duration > threshold) {
        timing.overThreshold++
      }

      // Trim to max samples
      if (timing.values.length > maxSamples) {
        timing.values.shift()
      }

      timing.startTime = 0
    },

    record(label: string, value: number) {
      if (!enabled) return
      const timing = getOrCreateTiming(label)
      timing.values.push(value)
      if (value > threshold) {
        timing.overThreshold++
      }
      if (timing.values.length > maxSamples) {
        timing.values.shift()
      }
    },

    increment(label: string) {
      if (!enabled) return
      counters.set(label, (counters.get(label) ?? 0) + 1)
    },

    getCounter(label: string): number {
      return counters.get(label) ?? 0
    },

    getCounters(): Record<string, number> {
      return Object.fromEntries(counters)
    },

    getStats(label: string): PerfStats | null {
      const timing = timings.get(label)
      if (!timing || timing.values.length === 0) return null

      const values = timing.values
      const sum = values.reduce((a, b) => a + b, 0)

      return {
        samples: values.length,
        avg: sum / values.length,
        max: Math.max(...values),
        min: Math.min(...values),
        overThreshold: timing.overThreshold,
      }
    },

    getAllStats(): Record<string, PerfStats> {
      const result: Record<string, PerfStats> = {}
      for (const [label] of timings) {
        const stats = this.getStats(label)
        if (stats) result[label] = stats
      }
      return result
    },

    reset() {
      timings.clear()
      counters.clear()
    },

    logSummary() {
      console.group('⚡ Performance Summary')

      // Timing stats
      const stats = this.getAllStats()
      const labels = Object.keys(stats).sort()

      if (labels.length > 0) {
        console.table(
          labels.reduce((acc, label) => {
            const s = stats[label]
            acc[label] = {
              'avg (ms)': s.avg.toFixed(2),
              'max (ms)': s.max.toFixed(2),
              'min (ms)': s.min.toFixed(2),
              'samples': s.samples,
              'slow': s.overThreshold,
              'slow %': ((s.overThreshold / s.samples) * 100).toFixed(1) + '%',
            }
            return acc
          }, {} as Record<string, any>)
        )
      }

      // Counters
      if (counters.size > 0) {
        console.log('Counters:', Object.fromEntries(counters))
      }

      console.groupEnd()
    },
  }
}

// Global perf monitor instance
let globalMonitor: PerfMonitor | null = null

/**
 * Get the global performance monitor
 */
export function getGlobalPerfMonitor(): PerfMonitor {
  if (!globalMonitor) {
    globalMonitor = createPerfMonitor()
  }
  return globalMonitor
}

/**
 * Quick timing helper - wraps an async function with timing
 */
export function timed<T>(label: string, fn: () => T): T {
  const monitor = getGlobalPerfMonitor()
  monitor.start(label)
  try {
    const result = fn()
    if (result instanceof Promise) {
      return result.finally(() => monitor.end(label)) as T
    }
    monitor.end(label)
    return result
  } catch (e) {
    monitor.end(label)
    throw e
  }
}
