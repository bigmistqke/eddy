/**
 * Performance monitoring utilities for identifying bottlenecks.
 *
 * Tree-shakeable when __ENABLE_PERF__ is false at build time.
 */

declare const __ENABLE_PERF__: boolean

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

export interface Stats {
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

/** Monitor function that wraps functions with timing and provides stats access */
export interface Monitor<
  TimingLabel extends string = string,
  CounterLabel extends string = string,
> {
  /** Wrap a function with timing */
  <T extends (...args: any[]) => any>(label: TimingLabel, fn: T): T
  /** Increment a counter */
  count(label: CounterLabel, amount?: number): void
  /** Get stats for a specific timing label */
  getStats(label: TimingLabel): Stats | null
  /** Get all timing stats */
  getAllStats(): Record<string, Stats>
  /** Get a counter value */
  getCounter(label: CounterLabel): number
  /** Get all counters */
  getCounters(): Record<string, number>
  /** Reset all stats and counters */
  reset(): void
  /** Log a summary to console */
  log(): void
}

/**********************************************************************************/
/*                                                                                */
/*                                 Make Monitor                                   */
/*                                                                                */
/**********************************************************************************/

interface Timing {
  values: number[]
  overThreshold: number
}

const THRESHOLD = 16.67 // 60fps frame budget
const MAX_SAMPLES = 1000

/**
 * Create a monitor function that wraps functions with timing and counting.
 *
 * @example
 * ```ts
 * const monitor = makeMonitor<'decode' | 'demux', 'frames-dropped'>()
 * const decode = monitor('decode', (chunk) => decoder.decode(chunk))
 * monitor.count('frames-dropped', 5)
 *
 * monitor.getAllStats()
 * monitor.getCounters()
 * monitor.reset()
 * ```
 */
export function makeMonitor<
  TimingLabel extends string = string,
  CounterLabel extends string = string,
>(): Monitor<TimingLabel, CounterLabel> {
  const timings = new Map<string, Timing>()
  const counters = new Map<string, number>()

  function getOrCreateTiming(label: string): Timing {
    let timing = timings.get(label)
    if (!timing) {
      timing = { values: [], overThreshold: 0 }
      timings.set(label, timing)
    }
    return timing
  }

  function record(label: string, duration: number): void {
    const timing = getOrCreateTiming(label)
    timing.values.push(duration)
    if (duration > THRESHOLD) {
      timing.overThreshold++
    }
    if (timing.values.length > MAX_SAMPLES) {
      timing.values.shift()
    }
  }

  function getStats(label: string): Stats | null {
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
  }

  function getAllStats(): Record<string, Stats> {
    const result: Record<string, Stats> = {}
    for (const [label] of timings) {
      const stats = getStats(label)
      if (stats) result[label] = stats
    }
    return result
  }

  function count(label: string, amount = 1): void {
    if (typeof __ENABLE_PERF__ !== 'undefined' && !__ENABLE_PERF__) {
      return
    }
    counters.set(label, (counters.get(label) ?? 0) + amount)
  }

  function getCounter(label: string): number {
    return counters.get(label) ?? 0
  }

  function getCounters(): Record<string, number> {
    return Object.fromEntries(counters)
  }

  function reset(): void {
    timings.clear()
    counters.clear()
  }

  function log(): void {
    console.group('⚡ Performance Summary')

    const stats = getAllStats()
    const labels = Object.keys(stats).sort()

    if (labels.length > 0) {
      console.table(
        labels.reduce(
          (acc, label) => {
            const stat = stats[label]
            acc[label] = {
              'avg (ms)': stat.avg.toFixed(2),
              'max (ms)': stat.max.toFixed(2),
              'min (ms)': stat.min.toFixed(2),
              samples: stat.samples,
              slow: stat.overThreshold,
              'slow %': ((stat.overThreshold / stat.samples) * 100).toFixed(1) + '%',
            }
            return acc
          },
          {} as Record<string, any>,
        ),
      )
    }

    if (counters.size > 0) {
      console.log('Counters:', Object.fromEntries(counters))
    }

    console.groupEnd()
  }

  // Create the monitor function
  const monitor = (<T extends (...args: any[]) => any>(label: TimingLabel, fn: T): T => {
    if (typeof __ENABLE_PERF__ !== 'undefined' && !__ENABLE_PERF__) {
      return fn
    }

    return ((...args) => {
      const start = performance.now()
      const result = fn(...args)
      if (result instanceof Promise) {
        return result.finally(() => record(label, performance.now() - start))
      }
      record(label, performance.now() - start)
      return result
    }) as T
  }) as Monitor<TimingLabel, CounterLabel>

  // Attach methods
  monitor.count = count as Monitor<TimingLabel, CounterLabel>['count']
  monitor.getStats = getStats as Monitor<TimingLabel, CounterLabel>['getStats']
  monitor.getAllStats = getAllStats
  monitor.getCounter = getCounter as Monitor<TimingLabel, CounterLabel>['getCounter']
  monitor.getCounters = getCounters
  monitor.reset = reset
  monitor.log = log

  return monitor
}
