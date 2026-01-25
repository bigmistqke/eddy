import type { AbsoluteProject } from '@eddy/lexicons'
import { describe, expect, it } from 'vitest'
import {
  compileAbsoluteTimeline,
  findSegmentAtTime,
  getActivePlacements,
} from '../compile-absolute-timeline'

/**********************************************************************************/
/*                                                                                */
/*                                 Test Helpers                                   */
/*                                                                                */
/**********************************************************************************/

/** Create a minimal valid project for testing */
function createTestProject(overrides: Partial<AbsoluteProject> = {}): AbsoluteProject {
  return {
    title: 'Test Project',
    canvas: { width: 640, height: 360 },
    groups: [
      {
        id: 'group-0',
        members: [{ id: 'track-0' }, { id: 'track-1' }, { id: 'track-2' }, { id: 'track-3' }],
        layout: { type: 'grid', columns: 2, rows: 2 },
      },
    ],
    tracks: [
      { id: 'track-0', clipIds: ['clip-0'] },
      { id: 'track-1', clipIds: ['clip-1'] },
      { id: 'track-2', clipIds: ['clip-2'] },
      { id: 'track-3', clipIds: [] },
    ],
    clips: [
      {
        id: 'clip-0',
        source: { type: 'stem', ref: { uri: 'at://did/dj.eddy.stem/0', cid: 'cid0' } },
        start: 0,
        duration: 10000, // 10 seconds
      },
      {
        id: 'clip-1',
        source: { type: 'stem', ref: { uri: 'at://did/dj.eddy.stem/1', cid: 'cid1' } },
        start: 0,
        duration: 15000, // 15 seconds
      },
      {
        id: 'clip-2',
        source: { type: 'stem', ref: { uri: 'at://did/dj.eddy.stem/2', cid: 'cid2' } },
        start: 5000, // starts at 5 seconds
        duration: 10000, // 10 seconds
      },
    ],
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

/**********************************************************************************/
/*                                                                                */
/*                              Basic Compilation                                 */
/*                                                                                */
/**********************************************************************************/

describe('compileLayoutTimeline', () => {
  it('compiles a simple 2x2 grid project', () => {
    const project = createTestProject()
    const timeline = compileAbsoluteTimeline(project, { width: 640, height: 360 })

    expect(timeline.duration).toBe(15) // max of all clips
    expect(timeline.segments.length).toBeGreaterThan(0)
  })

  it('calculates correct viewports for 2x2 grid', () => {
    const project = createTestProject()
    const timeline = compileAbsoluteTimeline(project, { width: 640, height: 360 })

    const segment = findSegmentAtTime(timeline, 0)
    expect(segment).not.toBeNull()

    // Track 0 should be top-left
    const clip0 = segment!.placements.find(p => p.clipId === 'clip-0')
    expect(clip0?.viewport).toEqual({
      x: 0,
      y: 0,
      width: 320,
      height: 180,
    })

    // Track 1 should be top-right
    const clip1 = segment!.placements.find(p => p.clipId === 'clip-1')
    expect(clip1?.viewport).toEqual({
      x: 320,
      y: 0,
      width: 320,
      height: 180,
    })
  })

  it('creates segments at transition points', () => {
    const project = createTestProject()
    const timeline = compileAbsoluteTimeline(project, { width: 640, height: 360 })

    // Segments: [0-5] [5-10] [10-15]
    expect(timeline.segments[0].startTime).toBe(0)
    expect(timeline.segments[0].endTime).toBe(5)
    expect(timeline.segments[0].placements).toHaveLength(2) // clip-0, clip-1

    expect(timeline.segments[1].startTime).toBe(5)
    expect(timeline.segments[1].endTime).toBe(10)
    expect(timeline.segments[1].placements).toHaveLength(3) // clip-0, clip-1, clip-2

    expect(timeline.segments[2].startTime).toBe(10)
    expect(timeline.segments[2].endTime).toBe(15)
    expect(timeline.segments[2].placements).toHaveLength(2) // clip-1, clip-2
  })

  it('handles empty project', () => {
    const project = createTestProject({ groups: [], tracks: [] })
    const timeline = compileAbsoluteTimeline(project, { width: 640, height: 360 })

    expect(timeline.duration).toBe(0)
    expect(timeline.segments).toHaveLength(0)
  })

  it('handles void members in grid', () => {
    const project = createTestProject({
      groups: [
        {
          id: 'group-0',
          members: [
            { id: 'track-0' },
            { type: 'void' }, // skip cell
            { id: 'track-1' },
            { id: 'track-2' },
          ],
          layout: { type: 'grid', columns: 2, rows: 2 },
        },
      ],
    })
    const timeline = compileAbsoluteTimeline(project, { width: 640, height: 360 })

    const segment = findSegmentAtTime(timeline, 7)
    expect(segment).not.toBeNull()

    // Track 1 should be at bottom-left (skipped top-right due to void)
    const clip1 = segment!.placements.find(p => p.clipId === 'clip-1')
    expect(clip1?.viewport).toEqual({
      x: 0,
      y: 180,
      width: 320,
      height: 180,
    })
  })

  it('handles stacked layout (no grid)', () => {
    const project = createTestProject({
      groups: [
        {
          id: 'group-0',
          members: [{ id: 'track-0' }, { id: 'track-1' }],
          // No layout = stacked
        },
      ],
    })
    const timeline = compileAbsoluteTimeline(project, { width: 640, height: 360 })

    const segment = findSegmentAtTime(timeline, 0)
    expect(segment).not.toBeNull()

    // Both clips should have full canvas viewport
    for (const placement of segment!.placements) {
      expect(placement.viewport).toEqual({
        x: 0,
        y: 0,
        width: 640,
        height: 360,
      })
    }
  })
})

/**********************************************************************************/
/*                                                                                */
/*                              Nested Groups                                     */
/*                                                                                */
/**********************************************************************************/

describe('nested groups', () => {
  it('compiles clip with group source', () => {
    const project: AbsoluteProject = {
      title: 'Nested Test',
      canvas: { width: 640, height: 360 },
      groups: [
        {
          id: 'root-group',
          members: [{ id: 'main-track' }],
        },
        {
          id: 'nested-group',
          members: [{ id: 'inner-track-a' }, { id: 'inner-track-b' }],
          layout: { type: 'grid', columns: 2, rows: 1 }, // Side by side
        },
      ],
      tracks: [
        { id: 'main-track', clipIds: ['group-clip'] },
        { id: 'inner-track-a', clipIds: ['stem-a'] },
        { id: 'inner-track-b', clipIds: ['stem-b'] },
      ],
      clips: [
        {
          id: 'group-clip',
          source: { type: 'group', id: 'nested-group' },
          start: 0,
          duration: 10000, // 10 seconds
        },
        {
          id: 'stem-a',
          source: { type: 'stem', ref: { uri: 'at://did/stem-a', cid: 'cid-a' } },
          start: 0,
          duration: 10000,
        },
        {
          id: 'stem-b',
          source: { type: 'stem', ref: { uri: 'at://did/stem-b', cid: 'cid-b' } },
          start: 0,
          duration: 10000,
        },
      ],
      createdAt: new Date().toISOString(),
    }

    const timeline = compileAbsoluteTimeline(project, { width: 640, height: 360 })

    expect(timeline.duration).toBe(10)
    expect(timeline.segments).toHaveLength(1)

    const segment = timeline.segments[0]
    expect(segment.placements).toHaveLength(2)

    // Inner tracks should have side-by-side viewports
    const placementA = segment.placements.find(p => p.clipId === 'stem-a')
    const placementB = segment.placements.find(p => p.clipId === 'stem-b')

    expect(placementA?.viewport).toEqual({ x: 0, y: 0, width: 320, height: 360 })
    expect(placementB?.viewport).toEqual({ x: 320, y: 0, width: 320, height: 360 })
  })

  it('handles layout transitions via sequential clips with different groups', () => {
    // This is the jam.eddy.dj use case:
    // First 5 seconds: vertical split (1 col, 2 rows)
    // Next 5 seconds: horizontal split (2 cols, 1 row)
    const project: AbsoluteProject = {
      title: 'Layout Transition Test',
      canvas: { width: 640, height: 360 },
      groups: [
        {
          id: 'root-group',
          members: [{ id: 'sequencer-track' }],
        },
        {
          id: 'layout-vertical',
          members: [{ id: 'track-a' }, { id: 'track-b' }],
          layout: { type: 'grid', columns: 1, rows: 2 }, // Stacked vertically
        },
        {
          id: 'layout-horizontal',
          members: [{ id: 'track-a' }, { id: 'track-b' }],
          layout: { type: 'grid', columns: 2, rows: 1 }, // Side by side
        },
      ],
      tracks: [
        { id: 'sequencer-track', clipIds: ['segment-1', 'segment-2'] },
        { id: 'track-a', clipIds: ['clip-a'] },
        { id: 'track-b', clipIds: ['clip-b'] },
      ],
      clips: [
        {
          id: 'segment-1',
          source: { type: 'group', id: 'layout-vertical' },
          start: 0,
          duration: 5000,
        },
        {
          id: 'segment-2',
          source: { type: 'group', id: 'layout-horizontal' },
          start: 5000,
          duration: 5000,
        },
        {
          id: 'clip-a',
          source: { type: 'stem', ref: { uri: 'at://did/stem-a', cid: 'cid-a' } },
          start: 0,
          duration: 10000,
        },
        {
          id: 'clip-b',
          source: { type: 'stem', ref: { uri: 'at://did/stem-b', cid: 'cid-b' } },
          start: 0,
          duration: 10000,
        },
      ],
      createdAt: new Date().toISOString(),
    }

    const timeline = compileAbsoluteTimeline(project, { width: 640, height: 360 })

    expect(timeline.duration).toBe(10)
    expect(timeline.segments).toHaveLength(2)

    // First segment (0-5): vertical layout
    const segment1 = timeline.segments[0]
    expect(segment1.startTime).toBe(0)
    expect(segment1.endTime).toBe(5)

    const s1_a = segment1.placements.find(p => p.clipId === 'clip-a')
    const s1_b = segment1.placements.find(p => p.clipId === 'clip-b')

    // Vertical: full width, half height each
    expect(s1_a?.viewport).toEqual({ x: 0, y: 0, width: 640, height: 180 })
    expect(s1_b?.viewport).toEqual({ x: 0, y: 180, width: 640, height: 180 })

    // Second segment (5-10): horizontal layout
    const segment2 = timeline.segments[1]
    expect(segment2.startTime).toBe(5)
    expect(segment2.endTime).toBe(10)

    const s2_a = segment2.placements.find(p => p.clipId === 'clip-a')
    const s2_b = segment2.placements.find(p => p.clipId === 'clip-b')

    // Horizontal: half width, full height each
    expect(s2_a?.viewport).toEqual({ x: 0, y: 0, width: 320, height: 360 })
    expect(s2_b?.viewport).toEqual({ x: 320, y: 0, width: 320, height: 360 })
  })

  it('handles time offset correctly in nested groups', () => {
    // Group clip starts at 2 seconds on main timeline
    // Inner clip starts at 1 second relative to group
    // So inner clip should appear at 3 seconds on main timeline
    const project: AbsoluteProject = {
      title: 'Time Offset Test',
      canvas: { width: 640, height: 360 },
      groups: [
        { id: 'root', members: [{ id: 'main-track' }] },
        { id: 'inner-group', members: [{ id: 'inner-track' }] },
      ],
      tracks: [
        { id: 'main-track', clipIds: ['group-clip'] },
        { id: 'inner-track', clipIds: ['inner-stem'] },
      ],
      clips: [
        {
          id: 'group-clip',
          source: { type: 'group', id: 'inner-group' },
          start: 2000, // Starts at 2s
          duration: 8000,
        },
        {
          id: 'inner-stem',
          source: { type: 'stem', ref: { uri: 'at://did/stem', cid: 'cid' } },
          start: 1000, // 1s relative to group
          duration: 5000,
        },
      ],
      createdAt: new Date().toISOString(),
    }

    const timeline = compileAbsoluteTimeline(project, { width: 640, height: 360 })

    // Inner clip should be at 2s + 1s = 3s to 2s + 1s + 5s = 8s
    const segment = findSegmentAtTime(timeline, 4)
    expect(segment).not.toBeNull()

    const placement = segment!.placements.find(p => p.clipId === 'inner-stem')
    expect(placement).toBeDefined()

    // Verify no placement before 3s
    const earlySegment = findSegmentAtTime(timeline, 2.5)
    expect(earlySegment?.placements.find(p => p.clipId === 'inner-stem')).toBeUndefined()
  })

  it('handles deeply nested groups', () => {
    // root -> group-a -> group-b -> track with stem
    const project: AbsoluteProject = {
      title: 'Deep Nesting Test',
      canvas: { width: 640, height: 360 },
      groups: [
        { id: 'root', members: [{ id: 'track-level-1' }] },
        {
          id: 'group-level-1',
          members: [{ id: 'track-level-2' }],
          layout: { type: 'grid', columns: 1, rows: 1 },
        },
        {
          id: 'group-level-2',
          members: [{ id: 'track-level-3' }],
          layout: { type: 'grid', columns: 1, rows: 1 },
        },
      ],
      tracks: [
        { id: 'track-level-1', clipIds: ['clip-1'] },
        { id: 'track-level-2', clipIds: ['clip-2'] },
        { id: 'track-level-3', clipIds: ['deep-stem'] },
      ],
      clips: [
        {
          id: 'clip-1',
          source: { type: 'group', id: 'group-level-1' },
          start: 0,
          duration: 10000,
        },
        {
          id: 'clip-2',
          source: { type: 'group', id: 'group-level-2' },
          start: 0,
          duration: 10000,
        },
        {
          id: 'deep-stem',
          source: { type: 'stem', ref: { uri: 'at://did/stem', cid: 'cid' } },
          start: 0,
          duration: 10000,
        },
      ],
      createdAt: new Date().toISOString(),
    }

    const timeline = compileAbsoluteTimeline(project, { width: 640, height: 360 })

    expect(timeline.duration).toBe(10)
    expect(timeline.segments).toHaveLength(1)

    const placement = timeline.segments[0].placements.find(p => p.clipId === 'deep-stem')
    expect(placement).toBeDefined()
    expect(placement?.viewport).toEqual({ x: 0, y: 0, width: 640, height: 360 })
  })

  it('calculates nested viewports correctly', () => {
    // Root group has 2x1 layout (left/right halves)
    // Left half contains a group with 1x2 layout (top/bottom)
    // So we get: left-top, left-bottom, and right-full
    const project: AbsoluteProject = {
      title: 'Nested Viewport Test',
      canvas: { width: 640, height: 360 },
      groups: [
        {
          id: 'root',
          members: [{ id: 'track-left' }, { id: 'track-right' }],
          layout: { type: 'grid', columns: 2, rows: 1 },
        },
        {
          id: 'group-left-split',
          members: [{ id: 'track-top' }, { id: 'track-bottom' }],
          layout: { type: 'grid', columns: 1, rows: 2 },
        },
      ],
      tracks: [
        { id: 'track-left', clipIds: ['left-group-clip'] },
        { id: 'track-right', clipIds: ['right-stem'] },
        { id: 'track-top', clipIds: ['top-stem'] },
        { id: 'track-bottom', clipIds: ['bottom-stem'] },
      ],
      clips: [
        {
          id: 'left-group-clip',
          source: { type: 'group', id: 'group-left-split' },
          start: 0,
          duration: 10000,
        },
        {
          id: 'right-stem',
          source: { type: 'stem', ref: { uri: 'at://did/right', cid: 'cid-r' } },
          start: 0,
          duration: 10000,
        },
        {
          id: 'top-stem',
          source: { type: 'stem', ref: { uri: 'at://did/top', cid: 'cid-t' } },
          start: 0,
          duration: 10000,
        },
        {
          id: 'bottom-stem',
          source: { type: 'stem', ref: { uri: 'at://did/bottom', cid: 'cid-b' } },
          start: 0,
          duration: 10000,
        },
      ],
      createdAt: new Date().toISOString(),
    }

    const timeline = compileAbsoluteTimeline(project, { width: 640, height: 360 })
    const segment = timeline.segments[0]

    // Right track: right half of canvas (320-640, 0-360)
    const rightPlacement = segment.placements.find(p => p.clipId === 'right-stem')
    expect(rightPlacement?.viewport).toEqual({ x: 320, y: 0, width: 320, height: 360 })

    // Top track: top-left quarter (0-320, 0-180)
    const topPlacement = segment.placements.find(p => p.clipId === 'top-stem')
    expect(topPlacement?.viewport).toEqual({ x: 0, y: 0, width: 320, height: 180 })

    // Bottom track: bottom-left quarter (0-320, 180-360)
    const bottomPlacement = segment.placements.find(p => p.clipId === 'bottom-stem')
    expect(bottomPlacement?.viewport).toEqual({ x: 0, y: 180, width: 320, height: 180 })
  })
})

/**********************************************************************************/
/*                                                                                */
/*                               Binary Search                                    */
/*                                                                                */
/**********************************************************************************/

describe('findSegmentAtTime (binary search)', () => {
  it('finds correct segment at various times', () => {
    const project = createTestProject()
    const timeline = compileAbsoluteTimeline(project, { width: 640, height: 360 })

    const seg0 = findSegmentAtTime(timeline, 2)
    expect(seg0?.startTime).toBe(0)
    expect(seg0?.endTime).toBe(5)

    const seg1 = findSegmentAtTime(timeline, 7)
    expect(seg1?.startTime).toBe(5)
    expect(seg1?.endTime).toBe(10)

    const seg2 = findSegmentAtTime(timeline, 12)
    expect(seg2?.startTime).toBe(10)
    expect(seg2?.endTime).toBe(15)
  })

  it('returns null for time outside segments', () => {
    const project = createTestProject()
    const timeline = compileAbsoluteTimeline(project, { width: 640, height: 360 })

    expect(findSegmentAtTime(timeline, 20)).toBeNull()
    expect(findSegmentAtTime(timeline, -1)).toBeNull()
  })
})

/**********************************************************************************/
/*                                                                                */
/*                            Active Placements                                   */
/*                                                                                */
/**********************************************************************************/

describe('getActivePlacements', () => {
  it('returns placements active at time 0', () => {
    const project = createTestProject()
    const timeline = compileAbsoluteTimeline(project, { width: 640, height: 360 })

    const active = getActivePlacements(timeline, 0)

    expect(active).toHaveLength(2)
    expect(active.map(a => a.placement.clipId).sort()).toEqual(['clip-0', 'clip-1'])
  })

  it('returns placements active at time 7', () => {
    const project = createTestProject()
    const timeline = compileAbsoluteTimeline(project, { width: 640, height: 360 })

    const active = getActivePlacements(timeline, 7)

    expect(active).toHaveLength(3)
  })

  it('calculates correct localTime', () => {
    const project = createTestProject()
    const timeline = compileAbsoluteTimeline(project, { width: 640, height: 360 })

    const active = getActivePlacements(timeline, 7)

    const clip2Active = active.find(a => a.placement.clipId === 'clip-2')
    expect(clip2Active?.localTime).toBe(2)
  })

  it('returns empty after all clips end', () => {
    const project = createTestProject()
    const timeline = compileAbsoluteTimeline(project, { width: 640, height: 360 })

    const active = getActivePlacements(timeline, 20)

    expect(active).toHaveLength(0)
  })
})

/**********************************************************************************/
/*                                                                                */
/*                          Multiple Clips Per Track                              */
/*                                                                                */
/**********************************************************************************/

describe('multiple clips per track', () => {
  it('handles multiple sequential clips', () => {
    const project = createTestProject({
      tracks: [{ id: 'track-0', clipIds: ['clip-0a', 'clip-0b'] }],
      clips: [
        {
          id: 'clip-0a',
          source: { type: 'stem', ref: { uri: 'at://did/dj.eddy.stem/0a', cid: 'cid0a' } },
          start: 0,
          duration: 5000,
        },
        {
          id: 'clip-0b',
          source: { type: 'stem', ref: { uri: 'at://did/dj.eddy.stem/0b', cid: 'cid0b' } },
          start: 5000,
          duration: 5000,
        },
      ],
      groups: [
        {
          id: 'group-0',
          members: [{ id: 'track-0' }],
          layout: { type: 'grid', columns: 1, rows: 1 },
        },
      ],
    })

    const timeline = compileAbsoluteTimeline(project, { width: 640, height: 360 })

    expect(timeline.segments).toHaveLength(2)
    expect(timeline.segments[0].placements[0].clipId).toBe('clip-0a')
    expect(timeline.segments[1].placements[0].clipId).toBe('clip-0b')
  })
})
