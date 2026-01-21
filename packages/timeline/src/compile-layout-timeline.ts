/**
 * Compile Layout Timeline
 *
 * Compiles hierarchical Project data into a flat LayoutTimeline.
 * The timeline uses segments with placements for O(log n) time queries.
 *
 * Key concepts:
 * - Clip: a time window that contains either a stem (media) or a group (nested structure)
 * - Track: infinite timeline containing clips, has a viewport
 * - Group: spatial container with layout (grid), contains tracks
 * - Placement: final flat structure - clip's position in space (viewport) and source timing
 * - Segment: a time range with stable layout (no clips starting/ending)
 *
 * Nesting model:
 * - Clips "clip space in time" - define when content plays
 * - Groups define how content is arranged spatially
 * - Same tracks can appear in multiple groups (layout transitions)
 */

import type { AbsoluteClip, AbsoluteProject, Group, Track, Value } from '@eddy/lexicons'
import type {
  CanvasSize,
  CompiledTimeline,
  EffectParamRef,
  EffectRef,
  LayoutSegment,
  Placement,
  Viewport,
  ActivePlacement,
} from './types'

/**********************************************************************************/
/*                                                                                */
/*                                  Internal Types                                */
/*                                                                                */
/**********************************************************************************/

/** Intermediate clip info before segmentation */
interface ClipInfo {
  clipId: string
  trackId: string
  viewport: Viewport
  timelineStart: number // When clip starts on timeline (seconds)
  timelineEnd: number // When clip ends on timeline (seconds)
  sourceIn: number // Source start time (seconds)
  sourceOut: number // Source end time (seconds)
  speed: number
  effectSignature: string
  effectKeys: string[]
  effectRefs: EffectRef[]
  effectParamRefs: EffectParamRef[]
}

/** Context passed down during recursive compilation */
interface CompileContext {
  project: AbsoluteProject
  trackMap: Map<string, Track>
  groupMap: Map<string, Group>
  parentMap: Map<string, Group>
  clipMap: Map<string, AbsoluteClip>
  canvasSize: CanvasSize
}

/** Time window constraint for nested content */
interface TimeWindow {
  start: number // Absolute start time on root timeline (seconds)
  end: number // Absolute end time on root timeline (seconds)
}

/**********************************************************************************/
/*                                                                                */
/*                                     Utils                                      */
/*                                                                                */
/**********************************************************************************/

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
function getRootGroup(project: AbsoluteProject): Group | undefined {
  if (project.rootGroup) {
    return project.groups.find(g => g.id === project.rootGroup)
  }
  return project.groups[0]
}

/** Build a map from track ID to Track */
function buildTrackMap(project: AbsoluteProject): Map<string, Track> {
  const trackMap = new Map<string, Track>()
  for (const track of project.tracks) {
    trackMap.set(track.id, track)
  }
  return trackMap
}

/** Build a map from group ID to Group */
function buildGroupMap(project: AbsoluteProject): Map<string, Group> {
  const groupMap = new Map<string, Group>()
  for (const group of project.groups) {
    groupMap.set(group.id, group)
  }
  return groupMap
}

/** Build a map from clip ID to Clip */
function buildClipMap(project: AbsoluteProject): Map<string, AbsoluteClip> {
  const clipMap = new Map<string, AbsoluteClip>()
  for (const clip of project.clips) {
    clipMap.set(clip.id, clip)
  }
  return clipMap
}

/** Build a map from member ID (track or group) to parent group */
function buildParentMap(project: AbsoluteProject): Map<string, Group> {
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
    const lastColon = ref.key.lastIndexOf(':')
    const effectKey = ref.key.slice(0, lastColon)

    if (effectKey !== lastEffectKey) {
      chainIndex++
      lastEffectKey = effectKey
    }
    paramRefs.push({ chainIndex, paramKey: ref.key.slice(lastColon + 1) })
  }

  return paramRefs
}

/**********************************************************************************/
/*                                                                                */
/*                               Viewport Calculation                             */
/*                                                                                */
/**********************************************************************************/

/** Calculate viewport for a grid cell within a parent viewport */
function calculateGridViewport(
  cellIndex: number,
  columns: number,
  rows: number,
  parentViewport: Viewport,
  gap = 0,
  padding = 0,
): Viewport {
  const col = cellIndex % columns
  const row = Math.floor(cellIndex / columns)

  // Calculate cell size accounting for gap and padding
  const totalGapX = gap * (columns - 1)
  const totalGapY = gap * (rows - 1)
  const availableWidth = parentViewport.width * (1 - 2 * padding) - totalGapX
  const availableHeight = parentViewport.height * (1 - 2 * padding) - totalGapY

  const cellWidth = availableWidth / columns
  const cellHeight = availableHeight / rows

  // Calculate position relative to parent viewport
  const paddingX = parentViewport.width * padding
  const paddingY = parentViewport.height * padding
  const x = parentViewport.x + paddingX + col * (cellWidth + gap)
  const y = parentViewport.y + paddingY + row * (cellHeight + gap)

  return {
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(cellWidth),
    height: Math.round(cellHeight),
  }
}

/** Calculate viewport for stacked layout (full parent viewport) */
function calculateStackViewport(parentViewport: Viewport): Viewport {
  return { ...parentViewport }
}

/**********************************************************************************/
/*                                                                                */
/*                                Effect Collection                               */
/*                                                                                */
/**********************************************************************************/

/**
 * Collect cascaded video effects for a clip.
 * Walks up the hierarchy: clip → track → group → parent groups... → root group
 */
function collectCascadedEffects(
  clip: AbsoluteClip,
  track: Track,
  ctx: CompileContext,
): EffectRef[] {
  const refs: EffectRef[] = []

  // 1. Clip effects
  const clipEffects = clip.videoPipeline?.effects
  if (clipEffects) {
    for (let index = 0; index < clipEffects.length; index++) {
      const effect = clipEffects[index]
      for (const paramKey of getEffectParamKeys(effect)) {
        refs.push({
          key: `clip:${clip.id}:${index}:${paramKey}`,
          effectType: effect.type,
        })
      }
    }
  }

  // 2. Track effects
  const trackEffects = track.videoPipeline?.effects
  if (trackEffects) {
    for (let index = 0; index < trackEffects.length; index++) {
      const effect = trackEffects[index]
      for (const paramKey of getEffectParamKeys(effect)) {
        refs.push({
          key: `track:${track.id}:${index}:${paramKey}`,
          effectType: effect.type,
        })
      }
    }
  }

  // 3. Walk up group hierarchy
  let currentId: string = track.id
  let parentGroup = ctx.parentMap.get(currentId)

  while (parentGroup) {
    const groupEffects = parentGroup.videoPipeline?.effects
    if (groupEffects) {
      for (let index = 0; index < groupEffects.length; index++) {
        const effect = groupEffects[index]
        for (const paramKey of getEffectParamKeys(effect)) {
          refs.push({
            key: `group:${parentGroup.id}:${index}:${paramKey}`,
            effectType: effect.type,
          })
        }
      }
    }
    currentId = parentGroup.id
    parentGroup = ctx.parentMap.get(currentId)
  }

  return refs
}

/**********************************************************************************/
/*                                                                                */
/*                              Recursive Compilation                             */
/*                                                                                */
/**********************************************************************************/

/**
 * Process a group's members and collect clip infos.
 * This handles the spatial arrangement (layout) of the group.
 *
 * @param timeWindow - Optional constraint that clips nested content to a time range
 */
function processGroup(
  group: Group,
  parentViewport: Viewport,
  timeOffset: number,
  timeScale: number,
  ctx: CompileContext,
  timeWindow?: TimeWindow,
): ClipInfo[] {
  const clipInfos: ClipInfo[] = []

  const layout = group.layout
  const columns = layout?.columns ?? 1
  const rows = layout?.rows ?? 1
  const gap = layout ? resolveValue(layout.gap, 0) : 0
  const padding = layout ? resolveValue(layout.padding, 0) : 0

  let cellIndex = 0
  for (const member of group.members) {
    if (isVoidMember(member)) {
      cellIndex++
      continue
    }

    const memberId = (member as { id: string }).id

    // Calculate viewport for this member
    const memberViewport = layout
      ? calculateGridViewport(cellIndex, columns, rows, parentViewport, gap, padding)
      : calculateStackViewport(parentViewport)

    // Member could be a track or a nested group
    const track = ctx.trackMap.get(memberId)
    const nestedGroup = ctx.groupMap.get(memberId)

    if (track) {
      // Process track's clips
      const trackClipInfos = processTrack(track, memberViewport, timeOffset, timeScale, ctx, timeWindow)
      clipInfos.push(...trackClipInfos)
    } else if (nestedGroup) {
      // Recursively process nested group
      const nestedClipInfos = processGroup(nestedGroup, memberViewport, timeOffset, timeScale, ctx, timeWindow)
      clipInfos.push(...nestedClipInfos)
    }

    cellIndex++
  }

  return clipInfos
}

/**
 * Process a track's clips and collect clip infos.
 * Handles both stem sources (creates ClipInfo) and group sources (recurses).
 *
 * @param timeWindow - Optional constraint that clips content to a time range
 */
function processTrack(
  track: Track,
  trackViewport: Viewport,
  timeOffset: number,
  timeScale: number,
  ctx: CompileContext,
  timeWindow?: TimeWindow,
): ClipInfo[] {
  const clipInfos: ClipInfo[] = []

  for (const clipId of track.clipIds) {
    const clip = ctx.clipMap.get(clipId)
    if (!clip) {
      throw new Error(`Clip not found: ${clipId} (referenced by track ${track.id})`)
    }

    const speed = resolveValue(clip.speed, 1) * timeScale
    let clipStart = timeOffset + clip.offset / 1000 // ms to seconds
    let clipEnd = timeOffset + (clip.offset + clip.duration) / 1000

    // Apply time window constraint if present
    if (timeWindow) {
      // Skip clips entirely outside the window
      if (clipEnd <= timeWindow.start || clipStart >= timeWindow.end) {
        continue
      }
      // Clamp to window bounds
      clipStart = Math.max(clipStart, timeWindow.start)
      clipEnd = Math.min(clipEnd, timeWindow.end)
    }

    if (clip.source?.type === 'group') {
      // Clip references a group - recurse into it
      const groupId = clip.source.id
      const group = ctx.groupMap.get(groupId)

      if (group) {
        // The group's content plays within this clip's time window
        // Create a new time window constraint for nested content
        const nestedWindow: TimeWindow = { start: clipStart, end: clipEnd }
        const nestedClipInfos = processGroup(
          group,
          trackViewport,
          clipStart,
          speed,
          ctx,
          nestedWindow,
        )
        clipInfos.push(...nestedClipInfos)
      }
    } else {
      // Clip references a stem - create ClipInfo
      // Adjust source timing if we're constrained by a time window
      const originalClipStart = timeOffset + clip.offset / 1000
      const sourceOffset = (clipStart - originalClipStart) * speed
      const sourceIn = (clip.sourceOffset ?? 0) / 1000 + sourceOffset
      const sourceOut = sourceIn + (clipEnd - clipStart) * speed

      // Collect cascaded effects
      const effectRefs = collectCascadedEffects(clip, track, ctx)
      const effectParamRefs = computeEffectParamRefs(effectRefs)

      // Build effectKeys (one per effect instance)
      const effectKeys: string[] = []
      let lastEffectKey = ''
      for (const ref of effectRefs) {
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
        viewport: trackViewport,
        timelineStart: clipStart,
        timelineEnd: clipEnd,
        sourceIn,
        sourceOut,
        speed,
        effectSignature,
        effectKeys,
        effectRefs,
        effectParamRefs,
      })
    }
  }

  return clipInfos
}

/**********************************************************************************/
/*                                                                                */
/*                               Segment Building                                 */
/*                                                                                */
/**********************************************************************************/

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
    const topClipPerTrack = new Map<string, ClipInfo>()

    for (const clip of clipInfos) {
      if (clip.timelineStart < endTime && clip.timelineEnd > startTime) {
        // Later clips overwrite earlier ones (last in array = highest priority)
        topClipPerTrack.set(clip.trackId, clip)
      }
    }

    // Build placements from the winning clips
    const placements: Placement[] = []
    for (const clip of topClipPerTrack.values()) {
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

    if (placements.length > 0) {
      segments.push({ startTime, endTime, placements })
    }
  }

  return segments
}

/**********************************************************************************/
/*                                                                                */
/*                                 Public API                                     */
/*                                                                                */
/**********************************************************************************/

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
 * Compile a Project into a LayoutTimeline.
 * Handles nested groups for layout transitions.
 */
export function compileLayoutTimeline(project: AbsoluteProject, canvasSize: CanvasSize): CompiledTimeline {
  const rootGroup = getRootGroup(project)
  if (!rootGroup) {
    return { duration: 0, segments: [] }
  }

  // Build lookup maps
  const ctx: CompileContext = {
    project,
    trackMap: buildTrackMap(project),
    groupMap: buildGroupMap(project),
    parentMap: buildParentMap(project),
    clipMap: buildClipMap(project),
    canvasSize,
  }

  // Root viewport is the full canvas
  const rootViewport: Viewport = {
    x: 0,
    y: 0,
    width: canvasSize.width,
    height: canvasSize.height,
  }

  // Process root group
  const clipInfos = processGroup(rootGroup, rootViewport, 0, 1, ctx)

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
