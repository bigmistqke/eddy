/**
 * @eddy/timeline
 *
 * Runtime utilities for querying project timeline data.
 * No pre-compilation - just query at render time.
 */

// Absolute timeline (ms) - primary API
export {
  computePlacements,
  getActiveMediaClips,
  getLayoutAtTime,
  getPlacementsAtTime,
  getProjectDuration,
} from './compile-absolute-timeline'

export type {
  ActiveClip,
  CanvasSize,
  Placement,
  Viewport,
} from './compile-absolute-timeline'

// Musical timeline (ticks) - converts to absolute internally
export { musicalToAbsolute } from './compile-musical-timeline'
export {
  getPlacementsAtTime as getMusicalPlacementsAtTime,
  getProjectDuration as getMusicalProjectDuration,
} from './compile-musical-timeline'
