/**
 * Priority Scheduler
 *
 * Uses SharedArrayBuffer for cross-worker coordination.
 * Recorder signals when encoder is backed up,
 * playback checks and skips delta frames accordingly.
 */

/** Branded type for scheduler buffer */
export type SchedulerBuffer = SharedArrayBuffer & { __brand: 'SchedulerBuffer' }

/** Single shared buffer for all scheduler coordination */
export const SCHEDULER_BUFFER = new SharedArrayBuffer(4) as SchedulerBuffer

/** Thresholds for encoder queue depth */
const HIGH_THRESHOLD = 5 // signal busy when queue exceeds this
const LOW_THRESHOLD = 2 // signal idle when queue drops below this

/**
 * Create scheduler from buffer.
 * Returns playback and recorder interfaces.
 */
export function makeScheduler(buffer: SchedulerBuffer) {
  const view = new Int32Array(buffer)

  return {
    playback: {
      /** Check if delta frames should be skipped due to encoder backpressure */
      shouldSkipDeltaFrames: () => Atomics.load(view, 0) === 1,
    },
    recorder: {
      /** Update scheduler state based on encoder queue depth */
      updateFromEncoder(queueSize: number) {
        const busy = Atomics.load(view, 0)
        if (queueSize > HIGH_THRESHOLD && !busy) Atomics.store(view, 0, 1)
        else if (queueSize < LOW_THRESHOLD && busy) Atomics.store(view, 0, 0)
      },
      /** Reset to idle state (call when recording stops) */
      reset: () => Atomics.store(view, 0, 0),
    },
  }
}

export type Scheduler = ReturnType<typeof makeScheduler>
export type PlaybackScheduler = Scheduler['playback']
export type RecorderScheduler = Scheduler['recorder']
