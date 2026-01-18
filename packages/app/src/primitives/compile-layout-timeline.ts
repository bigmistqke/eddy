/**
 * Compile Layout Timeline
 *
 * Compiles hierarchical Project data into a flat LayoutTimeline.
 * The timeline uses segments with placements for O(log n) time queries.
 *
 * Key concepts:
 * - Placement: a clip's position in space (viewport) and source timing
 * - Segment: a time range with stable layout (no clips starting/ending)
 * - Timeline: sorted segments for binary search by time
 */

import type { Clip, Group, Project, Track, Value } from '@eddy/lexicons'

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

/** Intermediate clip info before segmentation */
interface ClipInfo {
  clipId: string
  trackId: string
  viewport: Viewport
  timelineStart: number // When clip starts on timeline
  timelineEnd: number // When clip ends on timeline
  sourceIn: number // Source start time
  sourceOut: number // Source end time
  speed: number
  /** Video effect signature for shader caching */
  effectSignature: string
  /** Effect type keys in cascade order */
  effectKeys: string[]
  /** Effect references for value lookup (cascade order: clip → track → group... → master) */
  effectRefs: EffectRef[]
  /** Pre-computed param refs mapping each effectRef to its chain index */
  effectParamRefs: EffectParamRef[]
}

/** Resolve a Value to a number at a given time */
function resolveValue(value: Value | undefined, defaultValue: number, _time = 0): number {
  if (!value) return defaultValue
  // Static value - scaled by 100 in lexicon
  // TODO: Add curve ref evaluation when curve system is implemented
  return value.value / 100
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

/** Build a map from member ID (track or group) to parent group */
function buildParentMap(project: Project): Map<string, Group> {
  const parentMap = new Map<string, Group>()
  for (const group of project.groups) {
    for (const member of group.members) {
      if (!isVoidMember(member)) {
        const memberId = (member as { id: string }).id
        parentMap.set(memberId, group)
      }
    }
  }
  return parentMap
}

/** Build a map from group ID to Group */
function buildGroupMap(project: Project): Map<string, Group> {
  const groupMap = new Map<string, Group>()
  for (const group of project.groups) {
    groupMap.set(group.id, group)
  }
  return groupMap
}

/** Get param keys from an effect's params object */
function getEffectParamKeys(effect: { type: string; params?: unknown }): string[] {
  if (!effect.params || typeof effect.params !== 'object') return []
  return Object.keys(effect.params as object)
}

/** Compute effectParamRefs from effectRefs (maps each ref to its chain index) */
function computeEffectParamRefs(refs: EffectRef[]): EffectParamRef[] {
  const paramRefs: EffectParamRef[] = []
  let chainIndex = -1
  let lastEffectKey = ''

  for (const ref of refs) {
    // Key format: "sourceType:sourceId:effectIndex:paramKey"
    // Extract effectKey (everything before last :) and paramKey (after last :)
    const lastColon = ref.key.lastIndexOf(':')
    const effectKey = ref.key.slice(0, lastColon)
    const paramKey = ref.key.slice(lastColon + 1)

    if (effectKey !== lastEffectKey) {
      chainIndex++
      lastEffectKey = effectKey
    }
    paramRefs.push({ chainIndex, paramKey })
  }

  return paramRefs
}

/**
 * Collect cascaded video effects for a clip.
 * Walks up the hierarchy: clip → track → group → parent groups... → root group
 * The root group's videoPipeline serves as the master effects.
 * Creates one EffectRef per param (not per effect).
 */
function collectCascadedEffects(
  clip: Clip,
  track: Track,
  parentMap: Map<string, Group>,
  _groupMap: Map<string, Group>,
  _project: Project,
): EffectRef[] {
  const refs: EffectRef[] = []

  // 1. Clip effects
  if (clip.videoPipeline) {
    for (let index = 0; index < clip.videoPipeline.length; index++) {
      const effect = clip.videoPipeline[index]
      for (const paramKey of getEffectParamKeys(effect)) {
        refs.push({
          key: `clip:${clip.id}:${index}:${paramKey}`,
          effectType: effect.type,
        })
      }
    }
  }

  // 2. Track effects
  if (track.videoPipeline) {
    for (let index = 0; index < track.videoPipeline.length; index++) {
      const effect = track.videoPipeline[index]
      for (const paramKey of getEffectParamKeys(effect)) {
        refs.push({
          key: `track:${track.id}:${index}:${paramKey}`,
          effectType: effect.type,
        })
      }
    }
  }

  // 3. Walk up group hierarchy (root group's videoPipeline serves as master)
  let currentId: string = track.id
  let parentGroup = parentMap.get(currentId)

  while (parentGroup) {
    if (parentGroup.videoPipeline) {
      for (let index = 0; index < parentGroup.videoPipeline.length; index++) {
        const effect = parentGroup.videoPipeline[index]
        for (const paramKey of getEffectParamKeys(effect)) {
          refs.push({
            key: `group:${parentGroup.id}:${index}:${paramKey}`,
            effectType: effect.type,
          })
        }
      }
    }
    currentId = parentGroup.id
    parentGroup = parentMap.get(currentId)
  }

  return refs
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

/** Collect all clips with their timing and viewport info */
function collectClipInfos(project: Project, canvasSize: CanvasSize): ClipInfo[] {
  const rootGroup = getRootGroup(project)
  if (!rootGroup) return []

  // Build lookup maps
  const trackMap = new Map<string, Track>()
  for (const track of project.tracks) {
    trackMap.set(track.id, track)
  }
  const parentMap = buildParentMap(project)
  const groupMap = buildGroupMap(project)

  const clipInfos: ClipInfo[] = []

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
      cellIndex++
      continue
    }

    // Calculate viewport based on layout
    const viewport = layout
      ? calculateGridViewport(cellIndex, columns, rows, canvasSize, gap, padding)
      : calculateStackViewport(canvasSize)

    // Collect clip info
    for (const clip of track.clips) {
      // Skip group sources for now
      if (clip.source?.type === 'group') continue

      const speed = resolveValue(clip.speed, 1)
      const timelineStart = clip.offset / 1000 // ms to seconds
      const timelineEnd = (clip.offset + clip.duration) / 1000
      const sourceIn = (clip.sourceOffset ?? 0) / 1000
      const sourceOut = sourceIn + clip.duration / 1000

      // Collect cascaded video effects (one ref per param)
      const effectRefs = collectCascadedEffects(clip, track, parentMap, groupMap, project)
      // Pre-compute param refs (maps each ref to its chain index) - avoids per-frame allocation
      const effectParamRefs = computeEffectParamRefs(effectRefs)
      // Build effectKeys (one per effect instance, not per param) - preserves order and duplicates
      const effectKeys: string[] = []
      let lastEffectKey = ''
      for (const ref of effectRefs) {
        // Key format: "sourceType:sourceId:effectIndex:paramKey" - extract effect key (without paramKey)
        const lastColon = ref.key.lastIndexOf(':')
        const effectKey = ref.key.slice(0, lastColon)
        if (effectKey !== lastEffectKey) {
          effectKeys.push(ref.effectType)
          lastEffectKey = effectKey
        }
      }
      const effectSignature = effectKeys.join('|')

      clipInfos.push({
        clipId: clip.id,
        trackId: track.id,
        viewport,
        timelineStart,
        timelineEnd,
        sourceIn,
        sourceOut,
        speed,
        effectSignature,
        effectKeys,
        effectRefs,
        effectParamRefs,
      })
    }

    cellIndex++
  }

  return clipInfos
}

/** Build segments from clip transition points */
function buildSegments(clipInfos: ClipInfo[]): LayoutSegment[] {
  if (clipInfos.length === 0) return []

  // Collect all transition points (clip starts and ends)
  const transitionSet = new Set<number>()
  transitionSet.add(0) // Always start at 0

  for (const clip of clipInfos) {
    transitionSet.add(clip.timelineStart)
    transitionSet.add(clip.timelineEnd)
  }

  // Sort transition points
  const transitions = Array.from(transitionSet).sort((a, b) => a - b)

  // Build segments between consecutive transitions
  const segments: LayoutSegment[] = []

  for (let i = 0; i < transitions.length - 1; i++) {
    const startTime = transitions[i]
    const endTime = transitions[i + 1]

    // Find the TOP clip per track for this segment (punch-through behavior)
    // Later clips in clipInfos array have higher priority and overwrite earlier ones
    const topClipPerTrack = new Map<string, ClipInfo>()

    for (const clip of clipInfos) {
      // Clip is active if it overlaps with this segment
      if (clip.timelineStart < endTime && clip.timelineEnd > startTime) {
        // Later clips overwrite earlier ones (last in array = highest priority)
        topClipPerTrack.set(clip.trackId, clip)
      }
    }

    // Build placements from the winning clips
    const placements: Placement[] = []
    for (const clip of topClipPerTrack.values()) {
      // Calculate in-point for this segment:
      // Account for how far into the clip we are when this segment starts
      const segmentOffsetInClip = Math.max(0, startTime - clip.timelineStart) * clip.speed
      placements.push({
        clipId: clip.clipId,
        trackId: clip.trackId,
        viewport: clip.viewport,
        in: clip.sourceIn + segmentOffsetInClip,
        out: clip.sourceOut,
        speed: clip.speed,
        effectId: clip.effectSignature,
        effectKeys: clip.effectKeys,
        effectRefs: clip.effectRefs,
        effectParamRefs: clip.effectParamRefs,
      })
    }

    // Only add segment if it has placements
    if (placements.length > 0) {
      segments.push({ startTime, endTime, placements })
    }
  }

  return segments
}

/**
 * Binary search to find segment containing time.
 * Returns the segment or null if time is outside all segments.
 */
export function findSegmentAtTime(timeline: CompiledTimeline, time: number): LayoutSegment | null {
  const { segments } = timeline
  if (segments.length === 0) return null

  let low = 0
  let high = segments.length - 1

  while (low <= high) {
    const mid = Math.floor((low + high) / 2)
    const segment = segments[mid]

    if (time < segment.startTime) {
      high = mid - 1
    } else if (time >= segment.endTime) {
      low = mid + 1
    } else {
      // time is within this segment
      return segment
    }
  }

  return null
}

/**
 * Get all placements active at a given time with computed local times.
 * Uses binary search for O(log n) segment lookup.
 */
export function getActivePlacements(timeline: CompiledTimeline, time: number): ActivePlacement[] {
  const segment = findSegmentAtTime(timeline, time)
  if (!segment) return []

  const timeInSegment = time - segment.startTime

  return segment.placements.map(placement => ({
    placement,
    localTime: placement.in + timeInSegment * placement.speed,
  }))
}

/**
 * Compile a Project into a LayoutTimeline
 */
export function compileLayoutTimeline(project: Project, canvasSize: CanvasSize): CompiledTimeline {
  // Collect all clip info
  const clipInfos = collectClipInfos(project, canvasSize)

  // Build segments from transitions
  const segments = buildSegments(clipInfos)

  // Calculate duration
  let duration = 0
  for (const clip of clipInfos) {
    if (clip.timelineEnd > duration) {
      duration = clip.timelineEnd
    }
  }

  return { duration, segments }
}
