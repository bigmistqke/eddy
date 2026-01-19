/**
 * Timeline Types
 *
 * Type definitions for the compiled layout timeline.
 * These types are framework-agnostic and used by both the compiler and consumers.
 */

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

/** Reference to an effect param value for runtime lookup */
export interface EffectRef {
  /** Pre-computed lookup key (avoids string concatenation in hot path) */
  key: string
  /** Effect type for validation/debugging */
  effectType: string
}

/** Reference mapping a param to its effect chain index */
export interface EffectParamRef {
  /** Index of the effect in the compiled chain */
  chainIndex: number
  /** Parameter key (e.g., 'value', 'color', 'intensity') */
  paramKey: string
}

/** Viewport defines where to render on the canvas */
export interface Viewport {
  x: number // Left edge in pixels
  y: number // Top edge in pixels
  width: number
  height: number
}

/**
 * A placement describes where and how to render a clip.
 * This is a flat structure - no nesting.
 */
export interface Placement {
  /** Clip ID for frame lookup */
  clipId: string
  /** Track ID for audio routing */
  trackId: string
  /** Where to render on canvas */
  viewport: Viewport
  /** Source timing */
  in: number // Start time in source (seconds)
  out: number // End time in source (seconds)
  speed: number // Playback rate (1 = normal)

  /** Video effect signature - hash of effect types for shader caching */
  effectId: string
  /** Effect type keys in cascade order (pre-computed for compositor) */
  effectKeys: string[]
  /** References to effect values for runtime lookup (cascade order: clip → track → group... → master) */
  effectRefs: EffectRef[]
  /** Pre-computed param refs mapping each effectRef to its chain index (avoids per-frame allocation) */
  effectParamRefs: EffectParamRef[]
}

/**
 * A segment represents a time range where layout is stable.
 * No clips start or end within a segment - that would create a new segment.
 */
export interface LayoutSegment {
  /** When this segment starts on the timeline (seconds) */
  startTime: number
  /** When this segment ends on the timeline (seconds) */
  endTime: number
  /** All placements active during this segment */
  placements: Placement[]
}

/**
 * The compiled layout timeline.
 * Segments are sorted by startTime for O(log n) binary search.
 */
export interface CompiledTimeline {
  /** Total duration in seconds */
  duration: number
  /** Sorted segments (by startTime) */
  segments: LayoutSegment[]
}

/**
 * An active placement with computed local time.
 * Returned by getActivePlacements().
 */
export interface ActivePlacement {
  placement: Placement
  /** Time within the source (accounting for in/speed) */
  localTime: number
}

/** Info about the next transition point */
export interface TransitionInfo {
  /** When the transition occurs */
  time: number
  /** Placements starting at this time */
  starting: Placement[]
  /** Placements ending at this time */
  ending: Placement[]
}

/** Canvas dimensions for viewport calculation */
export interface CanvasSize {
  width: number
  height: number
}
