/**
 * @eddy/timeline
 *
 * Compiles hierarchical Project data into flat layout timelines.
 * Framework-agnostic, pure computation.
 */

export {
  compileLayoutTimeline,
  findSegmentAtTime,
  getActivePlacements,
} from './compile-layout-timeline'

export type {
  ActivePlacement,
  CanvasSize,
  CompiledTimeline,
  EffectParamRef,
  EffectRef,
  LayoutSegment,
  Placement,
  TransitionInfo,
  Viewport,
} from './types'
