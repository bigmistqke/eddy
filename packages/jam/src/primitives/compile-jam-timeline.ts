/**
 * Compile Jam Timeline
 *
 * Converts Jam columns + Project data into a CompiledTimeline.
 * Columns define time segments and layouts, tracks fill slots.
 */

import type { Project, Track, JamColumn, JamColumnDuration, JamLayoutType } from '@eddy/lexicons'
import type {
  CanvasSize,
  CompiledTimeline,
  LayoutSegment,
  Placement,
  Viewport,
} from '@eddy/timeline'

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

export interface JamCompileOptions {
  project: Project
  columns: JamColumn[]
  bpm: number
  canvasSize: CanvasSize
}

/** Layout slot configuration */
interface LayoutSlot {
  viewport: Viewport
}

/**********************************************************************************/
/*                                                                                */
/*                                   Constants                                    */
/*                                                                                */
/**********************************************************************************/

/** Duration multipliers relative to one bar (4 beats) */
const DURATION_MULTIPLIERS: Record<JamColumnDuration, number> = {
  '1': 1,
  '1/2': 0.5,
  '1/4': 0.25,
  '1/8': 0.125,
  '1/16': 0.0625,
}

/**********************************************************************************/
/*                                                                                */
/*                                     Utils                                      */
/*                                                                                */
/**********************************************************************************/

/** Convert BPM and bar duration to seconds */
function durationToSeconds(duration: JamColumnDuration, bpm: number): number {
  const beatsPerBar = 4
  const secondsPerBeat = 60 / bpm
  const secondsPerBar = secondsPerBeat * beatsPerBar
  return secondsPerBar * DURATION_MULTIPLIERS[duration]
}

/** Build track lookup map */
function buildTrackMap(project: Project): Map<string, Track> {
  const trackMap = new Map<string, Track>()
  for (const track of project.tracks) {
    trackMap.set(track.id, track)
  }
  return trackMap
}

/**********************************************************************************/
/*                                                                                */
/*                               Layout Calculation                               */
/*                                                                                */
/**********************************************************************************/

/** Calculate slots for a layout type */
function calculateLayoutSlots(
  layoutType: JamLayoutType,
  canvasSize: CanvasSize,
): LayoutSlot[] {
  const { width, height } = canvasSize

  switch (layoutType) {
    case 'full':
      return [{ viewport: { x: 0, y: 0, width, height } }]

    case 'pip': {
      // Main full, small overlay in corner
      const pipSize = Math.round(width * 0.25)
      const margin = Math.round(width * 0.02)
      return [
        { viewport: { x: 0, y: 0, width, height } },
        {
          viewport: {
            x: width - pipSize - margin,
            y: height - pipSize - margin,
            width: pipSize,
            height: pipSize,
          },
        },
      ]
    }

    case '2x2': {
      const halfW = Math.round(width / 2)
      const halfH = Math.round(height / 2)
      return [
        { viewport: { x: 0, y: 0, width: halfW, height: halfH } },
        { viewport: { x: halfW, y: 0, width: halfW, height: halfH } },
        { viewport: { x: 0, y: halfH, width: halfW, height: halfH } },
        { viewport: { x: halfW, y: halfH, width: halfW, height: halfH } },
      ]
    }

    case '3-up': {
      // One large on left, two stacked on right
      const leftW = Math.round(width * 0.66)
      const rightW = width - leftW
      const halfH = Math.round(height / 2)
      return [
        { viewport: { x: 0, y: 0, width: leftW, height } },
        { viewport: { x: leftW, y: 0, width: rightW, height: halfH } },
        { viewport: { x: leftW, y: halfH, width: rightW, height: halfH } },
      ]
    }

    case 'h-split': {
      const halfW = Math.round(width / 2)
      return [
        { viewport: { x: 0, y: 0, width: halfW, height } },
        { viewport: { x: halfW, y: 0, width: halfW, height } },
      ]
    }

    case 'v-split': {
      const halfH = Math.round(height / 2)
      return [
        { viewport: { x: 0, y: 0, width, height: halfH } },
        { viewport: { x: 0, y: halfH, width, height: halfH } },
      ]
    }

    default:
      return [{ viewport: { x: 0, y: 0, width, height } }]
  }
}

/** Get number of slots for a layout type */
function getSlotCount(layoutType: JamLayoutType): number {
  switch (layoutType) {
    case 'full':
      return 1
    case 'pip':
    case 'h-split':
    case 'v-split':
      return 2
    case '3-up':
      return 3
    case '2x2':
      return 4
    default:
      return 1
  }
}

/**********************************************************************************/
/*                                                                                */
/*                              Timeline Compilation                              */
/*                                                                                */
/**********************************************************************************/

/**
 * Find the active clip in a track at a given timeline time.
 * Returns the clip and its source time, or null if no clip is active.
 */
function findActiveClip(
  track: Track,
  timelineTime: number,
): { clipId: string; sourceTime: number; speed: number } | null {
  for (const clip of track.clips) {
    const clipStart = clip.offset / 1000 // ms to seconds
    const clipEnd = (clip.offset + clip.duration) / 1000

    if (timelineTime >= clipStart && timelineTime < clipEnd) {
      const sourceOffset = (clip.sourceOffset ?? 0) / 1000
      const speed = clip.speed?.value ? clip.speed.value / 100 : 1
      const timeInClip = (timelineTime - clipStart) * speed
      return {
        clipId: clip.id,
        sourceTime: sourceOffset + timeInClip,
        speed,
      }
    }
  }
  return null
}

/**
 * Compile jam columns into a layout timeline.
 */
export function compileJamTimeline(options: JamCompileOptions): CompiledTimeline {
  const { project, columns, bpm, canvasSize } = options

  if (columns.length === 0) {
    return { duration: 0, segments: [] }
  }

  const trackMap = buildTrackMap(project)
  const segments: LayoutSegment[] = []
  let currentTime = 0

  for (const column of columns) {
    const columnDuration = durationToSeconds(column.duration, bpm)
    const startTime = currentTime
    const endTime = currentTime + columnDuration

    // Calculate layout slots for this column
    const layoutSlots = calculateLayoutSlots(column.layout, canvasSize)
    const placements: Placement[] = []

    // Assign tracks to slots
    const slots = column.slots ?? []
    for (let slotIndex = 0; slotIndex < slots.length && slotIndex < layoutSlots.length; slotIndex++) {
      const trackId = slots[slotIndex]
      if (!trackId) continue

      const track = trackMap.get(trackId)
      if (!track) continue

      const slot = layoutSlots[slotIndex]

      // Find active clip at segment start
      const activeClip = findActiveClip(track, startTime)
      if (!activeClip) continue

      placements.push({
        clipId: activeClip.clipId,
        trackId: track.id,
        viewport: slot.viewport,
        in: activeClip.sourceTime,
        out: activeClip.sourceTime + columnDuration * activeClip.speed,
        speed: activeClip.speed,
        effectId: '',
        effectKeys: [],
        effectRefs: [],
        effectParamRefs: [],
      })
    }

    if (placements.length > 0) {
      segments.push({ startTime, endTime, placements })
    }

    currentTime = endTime
  }

  return {
    duration: currentTime,
    segments,
  }
}

/**********************************************************************************/
/*                                                                                */
/*                                   Helpers                                      */
/*                                                                                */
/**********************************************************************************/

/** Get the slot count for a layout type (useful for UI) */
export { getSlotCount }

/** Calculate column time boundaries (useful for snapping) */
export function calculateColumnBoundaries(columns: JamColumn[], bpm: number): number[] {
  const boundaries: number[] = [0]
  let currentTime = 0

  for (const column of columns) {
    currentTime += durationToSeconds(column.duration, bpm)
    boundaries.push(currentTime)
  }

  return boundaries
}

/** Find column index at a given time */
export function findColumnAtTime(columns: JamColumn[], bpm: number, time: number): number {
  let currentTime = 0

  for (let index = 0; index < columns.length; index++) {
    const columnDuration = durationToSeconds(columns[index].duration, bpm)
    if (time >= currentTime && time < currentTime + columnDuration) {
      return index
    }
    currentTime += columnDuration
  }

  return columns.length - 1
}
