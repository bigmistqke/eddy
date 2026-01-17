/**
 * CreateAheadScheduler
 *
 * Manages pre-buffering of playbacks ahead of time for gapless transitions.
 * Used for composition looping and potentially future clip transitions.
 *
 * The scheduler:
 * - Acquires workers from pools
 * - Loads and seeks playbacks to target media time
 * - Tracks ready state
 * - Returns prepared playbacks on activation
 */

import type { Playback } from '~/lib/create-playback'
import { createPlayback, type AudioWorkerRPC, type VideoWorkerRPC } from '~/lib/create-playback'
import type { SchedulerBuffer } from '~/lib/scheduler'
import type { WorkerPool } from '~/lib/worker-pool'
import { debug } from '@eddy/utils'

const log = debug('ahead-scheduler', false)

/** How far ahead to schedule (seconds) */
export const SCHEDULE_AHEAD = 0.5

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

interface ScheduledEntry {
  playback: Playback
  mediaTime: number
  ready: boolean
  loading: boolean
}

export interface AheadSchedulerConfig {
  videoWorkerPool: WorkerPool<VideoWorkerRPC>
  audioWorkerPool: WorkerPool<AudioWorkerRPC>
  schedulerBuffer: SchedulerBuffer
  /** Get audio destination for a track */
  getAudioDestination: (trackId: string) => AudioNode | undefined
}

export interface AheadScheduler {
  /**
   * Schedule a playback to be ready at mediaTime.
   * Does nothing if already scheduled for that time.
   */
  schedule(clipId: string, trackId: string, mediaTime: number): void

  /** Check if a playback is scheduled for this clip */
  hasScheduled(clipId: string): boolean

  /** Check if scheduled playback is ready */
  isReady(clipId: string): boolean

  /** Get the scheduled media time for a clip */
  getScheduledTime(clipId: string): number | null

  /**
   * Activate and remove scheduled playback.
   * Returns the playback if ready, null otherwise.
   */
  activate(clipId: string): Playback | null

  /** Cancel and clean up scheduled playback for clip */
  cancel(clipId: string): void

  /** Cancel all scheduled playbacks */
  cancelAll(): void

  /** Clean up all resources */
  destroy(): void
}

/**********************************************************************************/
/*                                                                                */
/*                            Create Ahead Scheduler                              */
/*                                                                                */
/**********************************************************************************/

export function createAheadScheduler(config: AheadSchedulerConfig): AheadScheduler {
  const { videoWorkerPool, audioWorkerPool, schedulerBuffer, getAudioDestination } = config

  // Scheduled playbacks keyed by clipId
  const scheduled = new Map<string, ScheduledEntry>()

  /** Clean up a scheduled entry */
  function cleanupEntry(entry: ScheduledEntry): void {
    entry.playback.destroy()
    videoWorkerPool.release(entry.playback.pooledVideoWorker)
    audioWorkerPool.release(entry.playback.pooledAudioWorker)
  }

  return {
    schedule(clipId, trackId, mediaTime) {
      const existing = scheduled.get(clipId)

      // Skip if already scheduled for same time
      if (existing && existing.mediaTime === mediaTime) {
        log('schedule: already scheduled for same time', { clipId, mediaTime })
        return
      }

      // Cancel existing if scheduled for different time
      if (existing) {
        log('schedule: canceling existing for different time', {
          clipId,
          oldTime: existing.mediaTime,
          newTime: mediaTime,
        })
        cleanupEntry(existing)
        scheduled.delete(clipId)
      }

      log('schedule: starting', { clipId, trackId, mediaTime })

      // Get audio destination
      const audioDestination = getAudioDestination(trackId)

      // Acquire workers from pools
      const videoWorker = videoWorkerPool.acquire()
      const audioWorker = audioWorkerPool.acquire()

      // Create playback
      const playback = createPlayback({
        videoWorker,
        audioWorker,
        schedulerBuffer,
        audioDestination,
      })

      // Store entry immediately (to prevent duplicate scheduling)
      const entry: ScheduledEntry = {
        playback,
        mediaTime,
        ready: false,
        loading: true,
      }
      scheduled.set(clipId, entry)

      // Load and seek async
      playback
        .load(clipId)
        .then(() => playback.seek(mediaTime))
        .then(() => {
          // Check entry still exists (might have been canceled)
          const current = scheduled.get(clipId)
          if (current === entry) {
            entry.ready = true
            entry.loading = false
            log('schedule: ready', { clipId, mediaTime })
          }
        })
        .catch(error => {
          log('schedule: failed', { clipId, mediaTime, error })
          // Clean up on failure
          const current = scheduled.get(clipId)
          if (current === entry) {
            cleanupEntry(entry)
            scheduled.delete(clipId)
          }
        })
    },

    hasScheduled(clipId) {
      return scheduled.has(clipId)
    },

    isReady(clipId) {
      return scheduled.get(clipId)?.ready ?? false
    },

    getScheduledTime(clipId) {
      return scheduled.get(clipId)?.mediaTime ?? null
    },

    activate(clipId) {
      const entry = scheduled.get(clipId)

      if (!entry) {
        log('activate: no scheduled playback', { clipId })
        return null
      }

      if (!entry.ready) {
        log('activate: not ready yet', { clipId, mediaTime: entry.mediaTime })
        return null
      }

      log('activate: returning playback', { clipId, mediaTime: entry.mediaTime })

      // Remove from scheduled (caller takes ownership)
      scheduled.delete(clipId)

      return entry.playback
    },

    cancel(clipId) {
      const entry = scheduled.get(clipId)

      if (!entry) return

      log('cancel', { clipId })
      cleanupEntry(entry)
      scheduled.delete(clipId)
    },

    cancelAll() {
      log('cancelAll', { count: scheduled.size })

      for (const entry of scheduled.values()) {
        cleanupEntry(entry)
      }
      scheduled.clear()
    },

    destroy() {
      log('destroy')
      this.cancelAll()
    },
  }
}
