/**
 * Absolute Timeline Utilities
 *
 * Simple runtime queries for the flat project structure.
 * No compilation - just query layout and media at render time.
 */

import type { AbsoluteClip, AbsoluteProject, ClipSourceLayout } from '@eddy/lexicons'

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

export interface CanvasSize {
  width: number
  height: number
}

export interface Viewport {
  x: number
  y: number
  width: number
  height: number
}

export interface ActiveClip {
  trackId: string
  clip: AbsoluteClip
  /** Time in source media (seconds) */
  sourceTime: number
}

export interface Placement {
  trackId: string
  clipId: string
  viewport: Viewport
  sourceTime: number
  speed: number
}

/**********************************************************************************/
/*                                                                                */
/*                                     Utils                                      */
/*                                                                                */
/**********************************************************************************/

/**
 * Find the active clip at a given time on a track.
 * Handles optional duration (extends to next clip).
 */
function findActiveClip(
  clips: AbsoluteClip[],
  timeMs: number,
): AbsoluteClip | null {
  // Sort clips by start time
  const sorted = [...clips].sort((a, b) => a.start - b.start)

  for (let i = 0; i < sorted.length; i++) {
    const clip = sorted[i]
    const clipStart = clip.start

    // Determine clip end: explicit duration or next clip's start
    let clipEnd: number
    if (clip.duration !== undefined) {
      clipEnd = clipStart + clip.duration
    } else {
      // Extends to next clip or infinity
      const nextClip = sorted[i + 1]
      clipEnd = nextClip ? nextClip.start : Infinity
    }

    if (timeMs >= clipStart && timeMs < clipEnd) {
      return clip
    }
  }

  return null
}

/**
 * Check if a clip source is a layout source
 */
function isLayoutSource(source: unknown): source is ClipSourceLayout {
  return (
    typeof source === 'object' &&
    source !== null &&
    'type' in source &&
    source.type === 'layout'
  )
}

/**********************************************************************************/
/*                                                                                */
/*                              Viewport Calculation                              */
/*                                                                                */
/**********************************************************************************/

/**
 * Calculate grid viewport for a slot
 */
function calculateGridViewport(
  slotIndex: number,
  columns: number,
  rows: number,
  canvas: CanvasSize,
  gap = 0,
): Viewport {
  const col = slotIndex % columns
  const row = Math.floor(slotIndex / columns)

  const gapPx = (gap / 100) * Math.min(canvas.width, canvas.height)
  const totalGapX = gapPx * (columns - 1)
  const totalGapY = gapPx * (rows - 1)

  const cellWidth = (canvas.width - totalGapX) / columns
  const cellHeight = (canvas.height - totalGapY) / rows

  return {
    x: Math.round(col * (cellWidth + gapPx)),
    y: Math.round(row * (cellHeight + gapPx)),
    width: Math.round(cellWidth),
    height: Math.round(cellHeight),
  }
}

/**
 * Calculate viewport for a layout mode and slot index
 */
function calculateViewport(
  layout: ClipSourceLayout,
  slotIndex: number,
  canvas: CanvasSize,
): Viewport {
  const { mode, columns, rows, gap } = layout

  switch (mode) {
    case 'grid': {
      const cols = columns ?? 2
      const rowCount = rows ?? Math.ceil(layout.slots.length / cols)
      return calculateGridViewport(slotIndex, cols, rowCount, canvas, gap)
    }

    case 'focus': {
      // First slot is fullscreen, rest are hidden (shouldn't reach here)
      return { x: 0, y: 0, width: canvas.width, height: canvas.height }
    }

    case 'pip': {
      // First slot is fullscreen, second is small corner
      if (slotIndex === 0) {
        return { x: 0, y: 0, width: canvas.width, height: canvas.height }
      }
      // PIP in bottom-right corner, 25% size
      const pipWidth = Math.round(canvas.width * 0.25)
      const pipHeight = Math.round(canvas.height * 0.25)
      const margin = 16
      return {
        x: canvas.width - pipWidth - margin,
        y: canvas.height - pipHeight - margin,
        width: pipWidth,
        height: pipHeight,
      }
    }

    case 'split': {
      // Horizontal split
      const splitWidth = Math.round(canvas.width / layout.slots.length)
      return {
        x: slotIndex * splitWidth,
        y: 0,
        width: splitWidth,
        height: canvas.height,
      }
    }

    default:
      return { x: 0, y: 0, width: canvas.width, height: canvas.height }
  }
}

/**********************************************************************************/
/*                                                                                */
/*                                  Public API                                    */
/*                                                                                */
/**********************************************************************************/

/**
 * Get the active layout at a given time.
 * Returns null if no layout is active (nothing displayed).
 */
export function getLayoutAtTime(
  project: AbsoluteProject,
  timeMs: number,
): ClipSourceLayout | null {
  const metadataTracks = project.metadataTracks ?? []

  for (const track of metadataTracks) {
    const clip = findActiveClip(track.clips, timeMs)
    if (clip && isLayoutSource(clip.source)) {
      return clip.source
    }
  }

  return null
}

/**
 * Get active media clips at a given time.
 * Returns clip info for each media track that has content.
 */
export function getActiveMediaClips(
  project: AbsoluteProject,
  timeMs: number,
): ActiveClip[] {
  const result: ActiveClip[] = []
  const timeSeconds = timeMs / 1000

  for (const track of project.mediaTracks) {
    const clip = findActiveClip(track.clips, timeMs)
    if (clip) {
      // Calculate source time
      const clipStartSeconds = clip.start / 1000
      const offsetSeconds = (clip.offset ?? 0) / 1000
      const speed = clip.speed?.value ? clip.speed.value / 100 : 1
      const timeInClip = timeSeconds - clipStartSeconds
      const sourceTime = offsetSeconds + timeInClip * speed

      result.push({
        trackId: track.id,
        clip,
        sourceTime,
      })
    }
  }

  return result
}

/**
 * Compute placements for active clips based on current layout.
 * Only clips in the layout's slots are included.
 */
export function computePlacements(
  layout: ClipSourceLayout,
  activeClips: ActiveClip[],
  canvas: CanvasSize,
): Placement[] {
  const placements: Placement[] = []

  // Build map of trackId -> activeClip for quick lookup
  const clipByTrack = new Map<string, ActiveClip>()
  for (const ac of activeClips) {
    clipByTrack.set(ac.trackId, ac)
  }

  // Only include tracks that are in the layout's slots
  for (let slotIndex = 0; slotIndex < layout.slots.length; slotIndex++) {
    const trackId = layout.slots[slotIndex]
    const activeClip = clipByTrack.get(trackId)

    if (activeClip) {
      const viewport = calculateViewport(layout, slotIndex, canvas)
      const speed = activeClip.clip.speed?.value ? activeClip.clip.speed.value / 100 : 1

      placements.push({
        trackId,
        clipId: activeClip.clip.id,
        viewport,
        sourceTime: activeClip.sourceTime,
        speed,
      })
    }
  }

  return placements
}

/**
 * Get all placements at a given time.
 * Combines layout lookup, media clip lookup, and viewport calculation.
 * Returns empty array if no layout is active.
 */
export function getPlacementsAtTime(
  project: AbsoluteProject,
  timeMs: number,
  canvas: CanvasSize,
): Placement[] {
  const layout = getLayoutAtTime(project, timeMs)
  if (!layout) return []

  const activeClips = getActiveMediaClips(project, timeMs)
  return computePlacements(layout, activeClips, canvas)
}

/**
 * Calculate project duration from all clips.
 */
export function getProjectDuration(project: AbsoluteProject): number {
  let maxEndMs = 0

  // Check media tracks
  for (const track of project.mediaTracks) {
    for (const clip of track.clips) {
      const end = clip.start + (clip.duration ?? 0)
      if (end > maxEndMs) maxEndMs = end
    }
  }

  // Check metadata tracks
  for (const track of project.metadataTracks ?? []) {
    for (const clip of track.clips) {
      const end = clip.start + (clip.duration ?? 0)
      if (end > maxEndMs) maxEndMs = end
    }
  }

  return maxEndMs
}
