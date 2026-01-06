/**
 * Layout Resolver
 *
 * Compiles hierarchical Project data into a flat LayoutTimeline.
 * The compositor walks this timeline for rendering.
 */

import type { Clip, Group, Project, Track, Value } from '@eddy/lexicons'
import type {
  ActiveSegment,
  LayoutSegment,
  LayoutSlot,
  LayoutTimeline,
  SegmentSource,
  TransitionInfo,
  Viewport,
} from './layout-types'

/** Canvas dimensions for viewport calculation */
export interface CanvasSize {
  width: number
  height: number
}

/** Resolve a Value (static or curve ref) to a number at a given time */
function resolveValue(value: Value | undefined, defaultValue: number, _time = 0): number {
  if (!value) return defaultValue
  if ('value' in value) {
    // Static value - scaled by 100 in lexicon
    return value.value / 100
  }
  // Curve ref - for now return min as default (TODO: implement curve evaluation)
  return (value.min ?? 0) / 100
}

/** Check if a member is a void placeholder */
function isVoidMember(member: { id?: string; type?: string }): boolean {
  return 'type' in member && member.type === 'void'
}

/** Get the root group from project */
function getRootGroup(project: Project): Group | undefined {
  if (project.rootGroup) {
    return project.groups.find(g => g.id === project.rootGroup)
  }
  return project.groups[0]
}

/** Calculate viewport for a grid cell */
function calculateGridViewport(
  cellIndex: number,
  columns: number,
  rows: number,
  canvasSize: CanvasSize,
  gap = 0,
  padding = 0,
): Viewport {
  const col = cellIndex % columns
  const row = Math.floor(cellIndex / columns)

  // Calculate cell size accounting for gap and padding
  const totalGapX = gap * (columns - 1)
  const totalGapY = gap * (rows - 1)
  const availableWidth = canvasSize.width * (1 - 2 * padding) - totalGapX
  const availableHeight = canvasSize.height * (1 - 2 * padding) - totalGapY

  const cellWidth = availableWidth / columns
  const cellHeight = availableHeight / rows

  // Calculate position
  const paddingX = canvasSize.width * padding
  const paddingY = canvasSize.height * padding
  const x = paddingX + col * (cellWidth + gap)
  const y = paddingY + row * (cellHeight + gap)

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(cellWidth),
    height: Math.round(cellHeight),
  }
}

/** Calculate viewport for stacked layout (all members full size) */
function calculateStackViewport(canvasSize: CanvasSize): Viewport {
  return {
    x: 0,
    y: 0,
    width: canvasSize.width,
    height: canvasSize.height,
  }
}

/** Convert clip to segment source */
function clipToSource(clip: Clip): SegmentSource | null {
  // Group source - TODO: implement nested timeline
  if (clip.source?.type === 'group') {
    return null
  }

  // Regular clip (blob fetched separately via clipId)
  const speed = resolveValue(clip.speed, 1)
  return {
    type: 'clip',
    clipId: clip.id,
    in: (clip.sourceOffset ?? 0) / 1000, // ms to seconds
    out: ((clip.sourceOffset ?? 0) + clip.duration) / 1000,
    speed,
  }
}

/** Compile a track's clips into segments with the given viewport */
function compileTrackSegments(track: Track, viewport: Viewport): LayoutSegment[] {
  const segments: LayoutSegment[] = []

  for (const clip of track.clips) {
    const source = clipToSource(clip)
    if (!source) continue

    segments.push({
      trackId: track.id,
      startTime: clip.offset / 1000, // ms to seconds
      endTime: (clip.offset + clip.duration) / 1000,
      viewport,
      source,
    })
  }

  // Sort by start time
  segments.sort((a, b) => a.startTime - b.startTime)

  return segments
}

/**
 * Compile a Project into a LayoutTimeline
 */
export function compileLayoutTimeline(project: Project, canvasSize: CanvasSize): LayoutTimeline {
  const rootGroup = getRootGroup(project)
  if (!rootGroup) {
    return { duration: 0, slots: [] }
  }

  // Build track lookup map
  const trackMap = new Map<string, Track>()
  for (const track of project.tracks) {
    trackMap.set(track.id, track)
  }

  // Build group lookup map (for future nested group support)
  const groupMap = new Map<string, Group>()
  for (const group of project.groups) {
    groupMap.set(group.id, group)
  }

  const slots: LayoutSlot[] = []
  let maxDuration = 0

  // Get layout info
  const layout = rootGroup.layout
  const columns = layout?.columns ?? 1
  const rows = layout?.rows ?? 1
  const gap = layout ? resolveValue(layout.gap, 0) : 0
  const padding = layout ? resolveValue(layout.padding, 0) : 0

  // Process members
  let cellIndex = 0
  for (const member of rootGroup.members) {
    if (isVoidMember(member)) {
      cellIndex++
      continue
    }

    const memberId = (member as { id: string }).id
    const track = trackMap.get(memberId)

    if (!track) {
      // Could be a nested group - skip for now
      cellIndex++
      continue
    }

    // Calculate viewport based on layout
    const viewport = layout
      ? calculateGridViewport(cellIndex, columns, rows, canvasSize, gap, padding)
      : calculateStackViewport(canvasSize)

    // Compile track segments
    const segments = compileTrackSegments(track, viewport)

    // Always include slot (even without segments) so preview/recording works
    slots.push({ trackId: track.id, viewport, segments })

    // Update max duration
    for (const seg of segments) {
      if (seg.endTime > maxDuration) {
        maxDuration = seg.endTime
      }
    }

    cellIndex++
  }

  return {
    duration: maxDuration,
    slots,
  }
}

/**
 * Get all segments active at a given time
 */
export function getActiveSegments(timeline: LayoutTimeline, time: number): ActiveSegment[] {
  const active: ActiveSegment[] = []

  for (const slot of timeline.slots) {
    for (const segment of slot.segments) {
      if (time >= segment.startTime && time < segment.endTime) {
        // Calculate local time within the source
        const timeInSegment = time - segment.startTime
        let localTime: number

        if (segment.source.type === 'stem') {
          // Account for source offset and speed
          localTime = segment.source.in + timeInSegment * segment.source.speed
        } else {
          // Nested timeline
          localTime = timeInSegment
        }

        active.push({ segment, localTime })
        break // Only one segment per slot at a time (for now)
      }
    }
  }

  return active
}

/**
 * Get all segments that overlap with a time range (for pre-buffering)
 */
export function getSegmentsInRange(
  timeline: LayoutTimeline,
  start: number,
  end: number,
): LayoutSegment[] {
  const segments: LayoutSegment[] = []

  for (const slot of timeline.slots) {
    for (const segment of slot.segments) {
      // Check if segment overlaps with range
      if (segment.endTime > start && segment.startTime < end) {
        segments.push(segment)
      }
    }
  }

  return segments
}

/**
 * Get the next transition point after a given time
 */
export function getNextTransition(
  timeline: LayoutTimeline,
  time: number,
): TransitionInfo | null {
  // Collect all transition times after current time
  const transitions = new Map<number, { starting: LayoutSegment[]; ending: LayoutSegment[] }>()

  for (const slot of timeline.slots) {
    for (const segment of slot.segments) {
      // Segment starts after current time
      if (segment.startTime > time) {
        const t = transitions.get(segment.startTime) ?? { starting: [], ending: [] }
        t.starting.push(segment)
        transitions.set(segment.startTime, t)
      }

      // Segment ends after current time
      if (segment.endTime > time) {
        const t = transitions.get(segment.endTime) ?? { starting: [], ending: [] }
        t.ending.push(segment)
        transitions.set(segment.endTime, t)
      }
    }
  }

  if (transitions.size === 0) return null

  // Find the earliest transition
  const times = Array.from(transitions.keys()).sort((a, b) => a - b)
  const nextTime = times[0]
  const info = transitions.get(nextTime)!

  return {
    time: nextTime,
    starting: info.starting,
    ending: info.ending,
  }
}
