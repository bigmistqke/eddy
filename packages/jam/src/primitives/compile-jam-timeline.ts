/**
 * Compile Jam Timeline
 *
 * Converts Jam metadata + MusicalProject data into a CompiledTimeline.
 * Layout regions define time spans with specific layouts, tracks fill slots.
 * Uses musical time (bars) internally, converts to seconds for output.
 */

import type { MusicalProject, MusicalClip, Track, JamColumnDuration, JamLayoutType, JamMetadata } from '@eddy/lexicons'
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
  project: MusicalProject
  metadata: JamMetadata
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

/** Convert bars to seconds */
function barsToSeconds(bars: number, bpm: number): number {
  const beatsPerBar = 4
  const secondsPerBeat = 60 / bpm
  return bars * beatsPerBar * secondsPerBeat
}

/** Build track lookup map */
function buildTrackMap(project: MusicalProject): Map<string, Track> {
  const trackMap = new Map<string, Track>()
  for (const track of project.tracks) {
    trackMap.set(track.id, track)
  }
  return trackMap
}

/** Build clip lookup map */
function buildClipMap(project: MusicalProject): Map<string, MusicalClip> {
  const clipMap = new Map<string, MusicalClip>()
  for (const clip of project.clips) {
    clipMap.set(clip.id, clip)
  }
  return clipMap
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
 * Find the active clip in a track at a given timeline time (in seconds).
 * Returns the clip and its source time, or null if no clip is active.
 */
function findActiveClip(
  track: Track,
  clipMap: Map<string, MusicalClip>,
  timelineTimeSec: number,
  bpm: number,
): { clipId: string; sourceTime: number; speed: number } | null {
  for (const clipId of track.clipIds) {
    const clip = clipMap.get(clipId)
    if (!clip) continue

    const clipStartSec = barsToSeconds(clip.bar, bpm)
    const clipEndSec = barsToSeconds(clip.bar + clip.bars, bpm)

    if (timelineTimeSec >= clipStartSec && timelineTimeSec < clipEndSec) {
      const sourceOffset = clip.sourceBar ? barsToSeconds(clip.sourceBar, bpm) : 0
      const speed = clip.speed?.value ? clip.speed.value / 100 : 1
      const timeInClip = (timelineTimeSec - clipStartSec) * speed
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
 * Compile jam metadata into a layout timeline.
 */
export function compileJamTimeline(options: JamCompileOptions): CompiledTimeline {
  const { project, metadata, canvasSize } = options
  const { bpm, columnCount, columnDuration, layoutRegions } = metadata

  if (columnCount === 0) {
    return { duration: 0, segments: [] }
  }

  const trackMap = buildTrackMap(project)
  const clipMap = buildClipMap(project)
  const segments: LayoutSegment[] = []
  const columnDurationSec = durationToSeconds(columnDuration, bpm)
  const totalDuration = columnCount * columnDurationSec

  // Process each layout region
  for (const region of layoutRegions) {
    const startTime = region.startColumn * columnDurationSec
    const endTime = region.endColumn * columnDurationSec
    const regionDuration = endTime - startTime

    // Calculate layout slots for this region
    const layoutSlots = calculateLayoutSlots(region.layout, canvasSize)
    const placements: Placement[] = []

    // Assign tracks to slots
    const slots = region.slots ?? []
    for (let slotIndex = 0; slotIndex < slots.length && slotIndex < layoutSlots.length; slotIndex++) {
      const trackId = slots[slotIndex]
      if (!trackId) continue

      const track = trackMap.get(trackId)
      if (!track) continue

      const slot = layoutSlots[slotIndex]

      // Find active clip at segment start
      const activeClip = findActiveClip(track, clipMap, startTime, bpm)
      if (!activeClip) continue

      // Use track.id as clipId since jam model is 1 stem per track
      // This matches the frame keys set by VideoPlayback
      placements.push({
        clipId: track.id,
        trackId: track.id,
        viewport: slot.viewport,
        in: activeClip.sourceTime,
        out: activeClip.sourceTime + regionDuration * activeClip.speed,
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
  }

  return {
    duration: totalDuration,
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
