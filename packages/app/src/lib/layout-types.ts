/**
 * Layout Timeline Types
 *
 * Intermediate representation compiled from Project data.
 * Used by compositor for rendering and by player for scheduling/buffering.
 */

/** Viewport defines where to render a segment on the canvas */
export interface Viewport {
  x: number // Left edge in pixels
  y: number // Top edge in pixels
  width: number
  height: number
}

/** Reference to a stem with timing info */
export interface SegmentSourceStem {
  type: 'stem'
  clipId: string // For tracking which clip this came from
  stemUri: string // AT Protocol URI to stem record
  in: number // Start time in source (seconds)
  out: number // End time in source (seconds)
  speed: number // Playback rate (1 = normal)
}

/** Reference to a nested timeline (for group clips) */
export interface SegmentSourceTimeline {
  type: 'timeline'
  timeline: LayoutTimeline
}

export type SegmentSource = SegmentSourceStem | SegmentSourceTimeline

/** A segment represents a clip on the timeline with its computed viewport */
export interface LayoutSegment {
  trackId: string
  startTime: number // When this segment starts on the timeline (seconds)
  endTime: number // When this segment ends on the timeline (seconds)
  viewport: Viewport // Where to render
  source: SegmentSource // What to render
}

/** A slot contains all segments for a single track */
export interface LayoutSlot {
  trackId: string
  segments: LayoutSegment[] // Sorted by startTime
}

/** The compiled layout timeline */
export interface LayoutTimeline {
  duration: number // Total duration in seconds
  slots: LayoutSlot[] // One per visible track
}

/** An active segment with computed local time */
export interface ActiveSegment {
  segment: LayoutSegment
  localTime: number // Time within the source (accounting for in/speed)
}

/** Info about the next transition point */
export interface TransitionInfo {
  time: number // When the transition occurs
  starting: LayoutSegment[] // Segments starting at this time
  ending: LayoutSegment[] // Segments ending at this time
}
