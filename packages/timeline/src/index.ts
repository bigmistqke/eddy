/**
 * @eddy/timeline
 *
 * Compiles hierarchical Project data into flat layout timelines.
 * Framework-agnostic, pure computation.
 */

export {
  compileAbsoluteTimeline,
  findSegmentAtTime,
  getActivePlacements
} from './compile-absolute-timeline'

export {
  compileMusicalTimeline,
  musicalToAbsolute
} from './compile-musical-timeline'

export type {
  ActivePlacement,
  CanvasSize,
  CompiledTimeline,
  EffectParamRef,
  EffectRef,
  LayoutSegment,
  Placement,
  TransitionInfo,
  Viewport
} from './types'

