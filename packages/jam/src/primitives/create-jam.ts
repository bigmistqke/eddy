/**
 * Create Jam
 *
 * State management for the Jam app.
 * Uses musical time domain (ticks) for clips.
 * Layout regions are clips on a layout track that reference layout groups.
 */

import type { Accessor } from 'solid-js'
import { createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import type {
  Group,
  JamColumnDuration,
  JamLayoutType,
  JamMetadata,
  MusicalClip,
  MusicalProject,
  Track,
} from '@eddy/lexicons'
import type { CompiledTimeline } from '@eddy/timeline'
import { compileMusicalTimeline } from '@eddy/timeline'

/**********************************************************************************/
/*                                                                                */
/*                                   Constants                                    */
/*                                                                                */
/**********************************************************************************/

const DEFAULT_PPQ = 960
const BEATS_PER_BAR = 4 // 4/4 time
const TICKS_PER_BAR = DEFAULT_PPQ * BEATS_PER_BAR // 3840

/** Layout track ID convention */
const LAYOUT_TRACK_ID = 'layout-track'

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

export interface CreateJamOptions {
  /** Initial project data (musical time domain) */
  initialProject?: MusicalProject
  /** Initial jam metadata */
  initialMetadata?: JamMetadata
  /** Initial track video URL mapping */
  initialTrackVideos?: Record<string, string>
  /** Canvas size for layout calculations */
  canvasSize: { width: number; height: number }
}

/** Clip position within cell */
export type ClipPosition = 'none' | 'start' | 'middle' | 'end' | 'single'

/** Layout region derived from layout track clip + group */
export interface LayoutRegion {
  clipId: string
  groupId: string
  startTick: number
  endTick: number
  startColumn: number
  endColumn: number
  layout: { type: 'grid'; columns: number; rows: number }
  slots: string[] // track IDs
}

/**********************************************************************************/
/*                                                                                */
/*                                   Defaults                                     */
/*                                                                                */
/**********************************************************************************/

function makeDefaultProject(): MusicalProject {
  return {
    schemaVersion: 1,
    title: 'Jam Session',
    canvas: { width: 640, height: 360 },
    bpm: 12000, // 120 BPM (scaled by 100)
    ppq: DEFAULT_PPQ,
    root: LAYOUT_TRACK_ID,
    groups: [
      // Layout groups - define composition for each region
      { id: 'layout-group-0', layout: { type: 'grid', columns: 1, rows: 1 }, members: [{ id: 'track-0' }] },
      { id: 'layout-group-1', layout: { type: 'grid', columns: 2, rows: 2 }, members: [{ id: 'track-0' }, { id: 'track-1' }, { id: 'track-2' }, { id: 'track-3' }] },
      { id: 'layout-group-2', layout: { type: 'grid', columns: 2, rows: 1 }, members: [{ id: 'track-0' }, { id: 'track-1' }] },
      { id: 'layout-group-3', layout: { type: 'grid', columns: 2, rows: 1 }, members: [{ id: 'track-0' }, { id: 'track-1' }] },
      { id: 'layout-group-4', layout: { type: 'grid', columns: 2, rows: 2 }, members: [{ id: 'track-0' }, { id: 'track-1' }, { id: 'track-2' }, { type: 'void' }] },
    ],
    tracks: [
      // Content tracks
      { id: 'track-0', name: 'Track 1', clipIds: ['clip-0'] },
      { id: 'track-1', name: 'Track 2', clipIds: ['clip-1a', 'clip-1b'] },
      { id: 'track-2', name: 'Track 3', clipIds: ['clip-2'] },
      { id: 'track-3', name: 'Track 4', clipIds: [] },
      // Layout track - clips define regions via group sources
      { id: LAYOUT_TRACK_ID, name: 'Layout', clipIds: ['layout-0', 'layout-1', 'layout-2', 'layout-3', 'layout-4'] },
    ],
    clips: [
      // Content clips (timing on content tracks)
      { id: 'clip-0', tick: 0, ticks: TICKS_PER_BAR * 3 },
      { id: 'clip-1a', tick: TICKS_PER_BAR, ticks: TICKS_PER_BAR },
      { id: 'clip-1b', tick: TICKS_PER_BAR * 2 + TICKS_PER_BAR / 2, ticks: TICKS_PER_BAR },
      { id: 'clip-2', tick: TICKS_PER_BAR * 2, ticks: TICKS_PER_BAR * 2 },
      // Layout clips (reference layout groups)
      { id: 'layout-0', tick: 0, ticks: TICKS_PER_BAR, source: { type: 'group', id: 'layout-group-0' } },
      { id: 'layout-1', tick: TICKS_PER_BAR, ticks: TICKS_PER_BAR, source: { type: 'group', id: 'layout-group-1' } },
      { id: 'layout-2', tick: TICKS_PER_BAR * 2, ticks: TICKS_PER_BAR * 2, source: { type: 'group', id: 'layout-group-2' } },
      { id: 'layout-3', tick: TICKS_PER_BAR * 4, ticks: TICKS_PER_BAR * 2, source: { type: 'group', id: 'layout-group-3' } },
      { id: 'layout-4', tick: TICKS_PER_BAR * 6, ticks: TICKS_PER_BAR * 2, source: { type: 'group', id: 'layout-group-4' } },
    ],
    createdAt: new Date().toISOString(),
  }
}

function makeDefaultMetadata(): JamMetadata {
  return {
    bpm: 120,
    columnCount: 8,
    columnDuration: '1',
  }
}

function makeDefaultTrackVideos(): Record<string, string> {
  return {
    'track-0': '/videos/big-buck-bunny.webm',
    'track-1': '/videos/sample-5s.webm',
    'track-2': '/videos/sample-10s.webm',
    'track-3': '/videos/sample-15s.webm',
  }
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/** Get number of slots for a layout type */
function getSlotCount(layoutType: JamLayoutType): number {
  switch (layoutType) {
    case 'full':
      return 1
    case 'pip':
    case 'h-split':
    case 'v-split':
      return 2
    case '3-up':
      return 3
    case '2x2':
      return 4
    default:
      return 1
  }
}

/**********************************************************************************/
/*                                                                                */
/*                                  Create Jam                                    */
/*                                                                                */
/**********************************************************************************/

export function createJam(options: CreateJamOptions) {
  const { canvasSize } = options

  // Core state
  const [project, setProject] = createStore<MusicalProject>(
    options.initialProject ?? makeDefaultProject()
  )
  const [metadata, setMetadata] = createStore<JamMetadata>(
    options.initialMetadata ?? makeDefaultMetadata()
  )
  const [trackVideos, setTrackVideos] = createStore<Record<string, string>>(
    options.initialTrackVideos ?? makeDefaultTrackVideos()
  )

  // Playback state
  const [isPlaying, setIsPlaying] = createSignal(false)
  const [currentTime, setCurrentTime] = createSignal(0)
  const [loop, setLoop] = createSignal(true)

  // UI state
  const [selectedColumnIndex, setSelectedColumnIndex] = createSignal<number | null>(null)

  // Paint session state - tracks original clip boundaries for overlap handling
  let paintSession: {
    trackId: string
    paintedClipId: string
    originalClips: Array<{ id: string; tick: number; ticks: number }>
  } | null = null
  const [orientation, setOrientation] = createSignal<'portrait' | 'landscape'>(
    window.innerHeight > window.innerWidth ? 'portrait' : 'landscape'
  )

  // Listen for orientation changes
  const handleResize = () => {
    setOrientation(window.innerHeight > window.innerWidth ? 'portrait' : 'landscape')
  }
  window.addEventListener('resize', handleResize)
  onCleanup(() => window.removeEventListener('resize', handleResize))

  // Derived state
  const timeline: Accessor<CompiledTimeline> = createMemo(() =>
    compileMusicalTimeline(project, canvasSize)
  )

  const duration = createMemo(() => timeline().duration)

  /** Get PPQ from project or use default */
  const ppq = createMemo(() => project.ppq ?? DEFAULT_PPQ)

  /** Get ticks per bar based on time signature (4/4 default) */
  const ticksPerBar = createMemo(() => ppq() * BEATS_PER_BAR)

  /** Get duration of a single column in ticks */
  const columnDurationTicks = createMemo(() => {
    const durationBars = parseDuration(metadata.columnDuration)
    return Math.round(durationBars * ticksPerBar())
  })

  /** Get duration of a single column in milliseconds */
  const columnDurationMs = createMemo(() => {
    return ticksToMs(columnDurationTicks())
  })

  /** Get column boundaries in ticks (for clip comparison) */
  const columnBoundariesTicks = createMemo(() => {
    const boundaries: number[] = []
    const colDuration = columnDurationTicks()
    for (let i = 0; i <= metadata.columnCount; i++) {
      boundaries.push(i * colDuration)
    }
    return boundaries
  })

  /** Get column boundaries in seconds (for playback) */
  const columnBoundaries = createMemo(() =>
    columnBoundariesTicks().map(ticks => ticksToSeconds(ticks))
  )

  const currentColumnIndex = createMemo(() => {
    const time = currentTime()
    const colDuration = columnDurationMs() / 1000
    return Math.min(Math.floor(time / colDuration), metadata.columnCount - 1)
  })

  /** Convert ticks to milliseconds */
  function ticksToMs(ticks: number): number {
    const bpm = project.bpm / 100 // Unscale BPM
    const msPerBeat = 60000 / bpm
    const msPerTick = msPerBeat / ppq()
    return ticks * msPerTick
  }

  /** Convert ticks to seconds */
  function ticksToSeconds(ticks: number): number {
    return ticksToMs(ticks) / 1000
  }

  /** Get layout track */
  const layoutTrack = createMemo(() =>
    project.tracks.find(t => t.id === LAYOUT_TRACK_ID)
  )

  /** Get all layout regions derived from layout track clips */
  const layoutRegions = createMemo((): LayoutRegion[] => {
    const track = layoutTrack()
    if (!track) return []

    const boundaries = columnBoundariesTicks()
    const regions: LayoutRegion[] = []

    for (const clipId of track.clipIds) {
      const clip = getClipById(clipId)
      if (!clip || clip.source?.type !== 'group') continue

      const groupSource = clip.source as { type: 'group'; id: string }
      const group = project.groups.find(g => g.id === groupSource.id)
      if (!group) continue

      const startTick = clip.tick
      const endTick = clip.tick + clip.ticks

      // Find column boundaries
      let startColumn = 0
      let endColumn = 0
      for (let i = 0; i < boundaries.length - 1; i++) {
        if (boundaries[i] <= startTick && startTick < boundaries[i + 1]) {
          startColumn = i
        }
        if (boundaries[i] < endTick && endTick <= boundaries[i + 1]) {
          endColumn = i + 1
        }
      }
      // Handle clips extending past last boundary
      if (endTick >= boundaries[boundaries.length - 1]) {
        endColumn = boundaries.length - 1
      }

      const slots = group.members
        .filter((m): m is { id: string } => 'id' in m)
        .map(m => m.id)

      regions.push({
        clipId: clip.id,
        groupId: group.id,
        startTick,
        endTick,
        startColumn,
        endColumn,
        layout: group.layout ?? { type: 'grid', columns: 1, rows: 1 },
        slots,
      })
    }

    return regions.sort((a, b) => a.startTick - b.startTick)
  })

  /** Get the layout region for a given column */
  function getLayoutRegionForColumn(columnIndex: number): LayoutRegion | null {
    return layoutRegions().find(
      region => columnIndex >= region.startColumn && columnIndex < region.endColumn
    ) ?? null
  }

  /** Get a column's position within its region (for visual styling) */
  type RegionPosition = 'none' | 'single' | 'start' | 'middle' | 'end'
  function getRegionPosition(columnIndex: number): RegionPosition {
    const region = getLayoutRegionForColumn(columnIndex)
    if (!region) return 'none'

    const regionLength = region.endColumn - region.startColumn
    if (regionLength === 1) return 'single'

    if (columnIndex === region.startColumn) return 'start'
    if (columnIndex === region.endColumn - 1) return 'end'
    return 'middle'
  }

  const selectedLayoutRegion = createMemo(() => {
    const index = selectedColumnIndex()
    return index !== null ? getLayoutRegionForColumn(index) : null
  })

  /** Parse duration string to bars (e.g., '1/2' -> 0.5) */
  function parseDuration(duration: JamColumnDuration): number {
    if (duration.includes('/')) {
      const [num, denom] = duration.split('/').map(Number)
      return num / denom
    }
    return Number(duration)
  }

  /** Get clips for a track by looking up clipIds */
  function getClipsForTrack(trackId: string): MusicalClip[] {
    const track = project.tracks.find(t => t.id === trackId)
    if (!track) return []
    return track.clipIds
      .map(id => project.clips.find(c => c.id === id))
      .filter((c): c is MusicalClip => c !== undefined)
  }

  /** Find clip by ID in project */
  function getClipById(clipId: string): MusicalClip | undefined {
    return project.clips.find(c => c.id === clipId)
  }

  /** Find clip index in project.clips */
  function getClipIndex(clipId: string): number {
    return project.clips.findIndex(c => c.id === clipId)
  }

  /**********************************************************************************/
  /*                                                                                */
  /*                                 Clip Helpers                                   */
  /*                                                                                */
  /**********************************************************************************/

  /** Find which clip (if any) overlaps a given column for a track */
  function getClipAtColumn(trackId: string, columnIndex: number): { clipId: string; clipIndex: number } | null {
    const track = project.tracks.find(t => t.id === trackId)
    if (!track) return null

    const boundaries = columnBoundariesTicks()
    const columnStartTick = boundaries[columnIndex]
    const columnEndTick = boundaries[columnIndex + 1]
    if (columnStartTick === undefined || columnEndTick === undefined) return null

    for (const clipId of track.clipIds) {
      const clip = getClipById(clipId)
      if (!clip) continue

      const clipStart = clip.tick
      const clipEnd = clip.tick + clip.ticks

      // Check if clip overlaps this column
      if (clipStart < columnEndTick && clipEnd > columnStartTick) {
        const clipIndex = getClipIndex(clipId)
        return { clipId, clipIndex }
      }
    }
    return null
  }

  /** Get the clip position within a cell (for visual styling) */
  function getClipPosition(trackId: string, columnIndex: number): ClipPosition {
    const clipInfo = getClipAtColumn(trackId, columnIndex)
    if (!clipInfo) return 'none'

    const clip = getClipById(clipInfo.clipId)
    if (!clip) return 'none'

    const boundaries = columnBoundariesTicks()
    const columnStartTick = boundaries[columnIndex]
    const columnEndTick = boundaries[columnIndex + 1]

    const clipStart = clip.tick
    const clipEnd = clip.tick + clip.ticks

    const startsInColumn = clipStart >= columnStartTick && clipStart < columnEndTick
    const endsInColumn = clipEnd > columnStartTick && clipEnd <= columnEndTick

    if (startsInColumn && endsInColumn) return 'single'
    if (startsInColumn) return 'start'
    if (endsInColumn) return 'end'
    return 'middle'
  }

  /** Check if a track has any clip content at a column */
  function hasClipAtColumn(trackId: string, columnIndex: number): boolean {
    return getClipAtColumn(trackId, columnIndex) !== null
  }

  /** Get all tracks that have clips in a column */
  function getTracksWithClipsInColumn(columnIndex: number): string[] {
    return project.tracks
      .filter(track => hasClipAtColumn(track.id, columnIndex))
      .map(track => track.id)
  }

  /** Get valid layouts for a column based on how many tracks have clips */
  function getValidLayoutsForColumn(columnIndex: number): JamLayoutType[] {
    const trackCount = getTracksWithClipsInColumn(columnIndex).length
    const layoutsBySlotCount: Record<number, JamLayoutType[]> = {
      0: ['full'],
      1: ['full'],
      2: ['pip', 'h-split', 'v-split'],
      3: ['3-up'],
      4: ['2x2'],
    }
    return layoutsBySlotCount[trackCount] ?? ['full']
  }

  /** Create a new clip at a column */
  function createClipAtColumn(trackId: string, columnIndex: number): string {
    const boundaries = columnBoundariesTicks()
    const columnStartTick = boundaries[columnIndex]
    const columnEndTick = boundaries[columnIndex + 1]
    if (columnStartTick === undefined || columnEndTick === undefined) return ''

    const clipId = `clip-${generateId()}`
    const newClip: MusicalClip = {
      id: clipId,
      tick: columnStartTick,
      ticks: columnEndTick - columnStartTick,
    }

    // Add clip to project.clips
    setProject('clips', clips => [...clips, newClip])

    // Add clipId to track
    setProject(
      'tracks',
      track => track.id === trackId,
      'clipIds',
      clipIds => [...clipIds, clipId]
    )

    return clipId
  }

  /** Remove clip at a column */
  function removeClipAtColumn(trackId: string, columnIndex: number) {
    const clipInfo = getClipAtColumn(trackId, columnIndex)
    if (!clipInfo) return

    // Remove clipId from track
    setProject(
      'tracks',
      track => track.id === trackId,
      'clipIds',
      clipIds => clipIds.filter(id => id !== clipInfo.clipId)
    )

    // Remove clip from project.clips
    setProject('clips', clips => clips.filter(c => c.id !== clipInfo.clipId))
  }

  /** Extend a clip to include an additional column */
  function extendClipToColumn(trackId: string, fromColumnIndex: number, toColumnIndex: number) {
    const clipInfo = getClipAtColumn(trackId, fromColumnIndex)
    if (!clipInfo) return

    const boundaries = columnBoundariesTicks()
    const clip = getClipById(clipInfo.clipId)
    if (!clip) return

    const targetColumnEndTick = boundaries[toColumnIndex + 1]
    const targetColumnStartTick = boundaries[toColumnIndex]
    if (targetColumnEndTick === undefined || targetColumnStartTick === undefined) return

    // Extend clip end or start depending on direction
    if (toColumnIndex > fromColumnIndex) {
      // Extending forward
      const newEnd = targetColumnEndTick
      setProject(
        'clips',
        clipInfo.clipIndex,
        'ticks',
        newEnd - clip.tick
      )
    } else {
      // Extending backward
      const newStart = targetColumnStartTick
      const newDuration = (clip.tick + clip.ticks) - newStart
      setProject(
        'clips',
        clipInfo.clipIndex,
        produce(c => {
          c.tick = newStart
          c.ticks = newDuration
        })
      )
    }
  }

  /** Start a paint session - stores original clip states for overlap handling */
  function startPaintSession(trackId: string, paintedClipId: string) {
    const clips = getClipsForTrack(trackId)

    paintSession = {
      trackId,
      paintedClipId,
      originalClips: clips.map(c => ({
        id: c.id,
        tick: c.tick,
        ticks: c.ticks,
      })),
    }
  }

  /** End paint session - commits current state */
  function endPaintSession() {
    paintSession = null
  }

  /** Set a clip to span exactly from anchorColumn to targetColumn (bidirectional) */
  function setClipSpan(trackId: string, anchorColumn: number, targetColumn: number) {
    const clipInfo = getClipAtColumn(trackId, anchorColumn)
    if (!clipInfo) return

    const boundaries = columnBoundariesTicks()
    const clip = getClipById(clipInfo.clipId)
    if (!clip) return

    const startColumn = Math.min(anchorColumn, targetColumn)
    const endColumn = Math.max(anchorColumn, targetColumn)

    const newStart = boundaries[startColumn]
    const newEnd = boundaries[endColumn + 1]
    if (newStart === undefined || newEnd === undefined) return

    // Update the painted clip
    setProject(
      'clips',
      clipInfo.clipIndex,
      produce(c => {
        c.tick = newStart
        c.ticks = newEnd - newStart
      })
    )

    // Handle overlapping clips if we have a paint session
    if (paintSession && paintSession.trackId === trackId) {
      handleOverlappingClips(trackId, clip.id, newStart, newEnd)
    }
  }

  /** Shrink overlapping clips, restoring toward original bounds on drag-back */
  function handleOverlappingClips(
    trackId: string,
    paintedClipId: string,
    paintedStart: number,
    paintedEnd: number
  ) {
    if (!paintSession) return

    const track = project.tracks.find(t => t.id === trackId)
    if (!track) return

    for (const clipId of track.clipIds) {
      if (clipId === paintedClipId) continue

      const clip = getClipById(clipId)
      if (!clip) continue

      const clipIndex = getClipIndex(clipId)
      if (clipIndex === -1) continue

      const original = paintSession.originalClips.find(c => c.id === clipId)
      if (!original) continue

      const originalStart = original.tick
      const originalEnd = original.tick + original.ticks

      // Check if original clip would overlap with painted area
      if (originalStart < paintedEnd && originalEnd > paintedStart) {
        // Clip overlaps - need to shrink it
        let newClipStart = originalStart
        let newClipEnd = originalEnd

        // If painted area covers the start of this clip, push start forward
        if (paintedEnd > originalStart && paintedStart <= originalStart) {
          newClipStart = paintedEnd
        }

        // If painted area covers the end of this clip, push end backward
        if (paintedStart < originalEnd && paintedEnd >= originalEnd) {
          newClipEnd = paintedStart
        }

        // If painted area is in the middle, shrink from the appropriate side
        if (paintedStart > originalStart && paintedEnd < originalEnd) {
          // Painted area is fully inside this clip - shrink from end (arbitrary choice)
          newClipEnd = paintedStart
        }

        // Ensure clip still has positive duration
        if (newClipEnd <= newClipStart) {
          // Clip would be eliminated - set to minimum size at boundary
          newClipStart = paintedEnd
          newClipEnd = paintedEnd
        }

        // Apply changes if different from current
        const currentStart = clip.tick
        const currentEnd = clip.tick + clip.ticks

        if (newClipStart !== currentStart || newClipEnd !== currentEnd) {
          setProject(
            'clips',
            clipIndex,
            produce(c => {
              c.tick = newClipStart
              c.ticks = Math.max(0, newClipEnd - newClipStart)
            })
          )
        }
      } else {
        // No overlap - restore to original if it was changed
        const currentStart = clip.tick
        const currentEnd = clip.tick + clip.ticks

        if (currentStart !== originalStart || currentEnd !== originalEnd) {
          setProject(
            'clips',
            clipIndex,
            produce(c => {
              c.tick = originalStart
              c.ticks = original.ticks
            })
          )
        }
      }
    }
  }

  /** Toggle clip at column - create if none, remove if clicking on start/single, extend if adjacent */
  function toggleClipAtColumn(columnIndex: number, trackId: string) {
    const position = getClipPosition(trackId, columnIndex)

    if (position === 'none') {
      // Check if adjacent column has a clip we can extend
      const prevPosition = columnIndex > 0 ? getClipPosition(trackId, columnIndex - 1) : 'none'
      const nextPosition = columnIndex < metadata.columnCount - 1 ? getClipPosition(trackId, columnIndex + 1) : 'none'

      if (prevPosition !== 'none' && prevPosition !== 'end' && prevPosition !== 'single') {
        // Extend previous clip forward
        extendClipToColumn(trackId, columnIndex - 1, columnIndex)
      } else if (nextPosition !== 'none' && nextPosition !== 'start' && nextPosition !== 'single') {
        // Extend next clip backward
        extendClipToColumn(trackId, columnIndex + 1, columnIndex)
      } else {
        // Create new single-column clip
        createClipAtColumn(trackId, columnIndex)
      }
    } else if (position === 'start' || position === 'single') {
      // Remove the entire clip
      removeClipAtColumn(trackId, columnIndex)
    } else {
      // middle or end - shrink clip by removing this column
      // For now, just remove the whole clip (simpler UX)
      removeClipAtColumn(trackId, columnIndex)
    }
  }

  // Playback loop
  let animationFrame: number | null = null
  let lastFrameTime: number | null = null

  createEffect(
    on(isPlaying, playing => {
      if (playing) {
        lastFrameTime = performance.now()
        const tick = (now: number) => {
          if (!isPlaying()) return

          const delta = (now - (lastFrameTime ?? now)) / 1000
          lastFrameTime = now

          setCurrentTime(time => {
            const newTime = time + delta
            const _duration = duration()

            if (newTime >= _duration) {
              if (loop()) {
                return newTime % _duration
              } else {
                setIsPlaying(false)
                return _duration
              }
            }
            return newTime
          })

          animationFrame = requestAnimationFrame(tick)
        }
        animationFrame = requestAnimationFrame(tick)
      } else {
        if (animationFrame !== null) {
          cancelAnimationFrame(animationFrame)
          animationFrame = null
        }
        lastFrameTime = null
      }
    })
  )

  onCleanup(() => {
    if (animationFrame !== null) {
      cancelAnimationFrame(animationFrame)
    }
  })

  /**********************************************************************************/
  /*                                                                                */
  /*                                Column Actions                                  */
  /*                                                                                */
  /**********************************************************************************/

  function addColumn() {
    setMetadata('columnCount', count => count + 1)
  }

  function removeColumn() {
    if (metadata.columnCount <= 1) return // Keep at least one column

    const lastColumn = metadata.columnCount - 1
    const lastColumnEndTick = columnBoundariesTicks()[lastColumn]

    // Shrink any layout clips that extend past the new column count
    const track = layoutTrack()
    if (track) {
      for (const clipId of track.clipIds) {
        const clipIndex = getClipIndex(clipId)
        const clip = getClipById(clipId)
        if (!clip || clipIndex === -1) continue

        const clipEnd = clip.tick + clip.ticks
        if (clipEnd > lastColumnEndTick) {
          if (clip.tick >= lastColumnEndTick) {
            // Clip starts after new end - remove it
            setProject(
              'tracks',
              t => t.id === LAYOUT_TRACK_ID,
              'clipIds',
              ids => ids.filter(id => id !== clipId)
            )
            setProject('clips', clips => clips.filter(c => c.id !== clipId))
          } else {
            // Shrink clip to fit
            setProject('clips', clipIndex, 'ticks', lastColumnEndTick - clip.tick)
          }
        }
      }
    }

    setMetadata('columnCount', count => count - 1)

    // Adjust selection if needed
    if (selectedColumnIndex() !== null && selectedColumnIndex()! >= metadata.columnCount - 1) {
      setSelectedColumnIndex(metadata.columnCount - 2)
    }
  }

  function setColumnDuration(duration: JamColumnDuration) {
    setMetadata('columnDuration', duration)
  }

  /**********************************************************************************/
  /*                                                                                */
  /*                              Layout Region Actions                             */
  /*                                                                                */
  /**********************************************************************************/

  /** Find a layout region by column */
  function findLayoutRegionIndex(columnIndex: number): number {
    return layoutRegions().findIndex(
      region => columnIndex >= region.startColumn && columnIndex < region.endColumn
    )
  }

  /** Get layout type string from grid layout */
  function layoutToType(layout: { type: 'grid'; columns: number; rows: number }): string {
    const { columns, rows } = layout
    if (columns === 1 && rows === 1) return 'full'
    if (columns === 2 && rows === 1) return 'h-split'
    if (columns === 1 && rows === 2) return 'v-split'
    if (columns === 2 && rows === 2) return '2x2'
    return `${columns}x${rows}`
  }

  /** Convert layout type string to grid config */
  function typeToLayout(type: string): { type: 'grid'; columns: number; rows: number } {
    switch (type) {
      case 'full': return { type: 'grid', columns: 1, rows: 1 }
      case 'h-split': return { type: 'grid', columns: 2, rows: 1 }
      case 'v-split': return { type: 'grid', columns: 1, rows: 2 }
      case '2x2': return { type: 'grid', columns: 2, rows: 2 }
      case '3-up': return { type: 'grid', columns: 2, rows: 2 } // 3-up uses 2x2 with void
      case 'pip': return { type: 'grid', columns: 2, rows: 1 } // pip uses 2x1
      default: return { type: 'grid', columns: 1, rows: 1 }
    }
  }

  /** Create or update a layout region for a range of columns */
  function setLayoutRegion(startColumn: number, endColumn: number, layoutType: string) {
    const boundaries = columnBoundariesTicks()
    const startTick = boundaries[startColumn]
    const endTick = boundaries[endColumn]
    if (startTick === undefined || endTick === undefined) return

    // Remove any existing layout clips that overlap with this range
    const track = layoutTrack()
    if (track) {
      const clipsToRemove: string[] = []
      for (const clipId of track.clipIds) {
        const clip = getClipById(clipId)
        if (!clip) continue
        const clipEnd = clip.tick + clip.ticks
        // Check overlap
        if (clip.tick < endTick && clipEnd > startTick) {
          clipsToRemove.push(clipId)
        }
      }
      // Remove overlapping clips
      for (const clipId of clipsToRemove) {
        setProject(
          'tracks',
          t => t.id === LAYOUT_TRACK_ID,
          'clipIds',
          ids => ids.filter(id => id !== clipId)
        )
        setProject('clips', clips => clips.filter(c => c.id !== clipId))
      }
    }

    // Create new group for this region
    const groupId = `layout-group-${generateId()}`
    const newGroup: Group = {
      id: groupId,
      layout: typeToLayout(layoutType),
      members: [],
    }
    setProject('groups', groups => [...groups, newGroup])

    // Create new layout clip
    const clipId = `layout-${generateId()}`
    const newClip: MusicalClip = {
      id: clipId,
      tick: startTick,
      ticks: endTick - startTick,
      source: { type: 'group', id: groupId },
    }
    setProject('clips', clips => [...clips, newClip])

    // Add to layout track
    setProject(
      'tracks',
      t => t.id === LAYOUT_TRACK_ID,
      'clipIds',
      ids => [...ids, clipId]
    )
  }

  /** Remove layout region at column */
  function removeLayoutRegion(columnIndex: number) {
    const region = getLayoutRegionForColumn(columnIndex)
    if (!region) return

    // Remove the layout clip
    setProject(
      'tracks',
      t => t.id === LAYOUT_TRACK_ID,
      'clipIds',
      ids => ids.filter(id => id !== region.clipId)
    )
    setProject('clips', clips => clips.filter(c => c.id !== region.clipId))

    // Optionally remove the group if no longer referenced
    // (for now, leave orphaned groups - they don't hurt)
  }

  /** Assign a slot in a layout region */
  function assignSlotInRegion(regionIndex: number, slotIndex: number, trackId: string | null) {
    const regions = layoutRegions()
    if (regionIndex < 0 || regionIndex >= regions.length) return

    const region = regions[regionIndex]
    const groupIndex = project.groups.findIndex(g => g.id === region.groupId)
    if (groupIndex === -1) return

    setProject('groups', groupIndex, produce((group: Group) => {
      // Ensure members array is large enough
      while (group.members.length <= slotIndex) {
        group.members.push({ type: 'void' })
      }

      // Remove trackId from any other slot in this group first
      if (trackId) {
        group.members = group.members.map(m =>
          'id' in m && m.id === trackId ? { type: 'void' } : m
        )
      }

      // Assign to target slot
      group.members[slotIndex] = trackId ? { id: trackId } : { type: 'void' }
    }))
  }

  /** Check if a track is in the layout region containing a column */
  function isTrackInColumn(columnIndex: number, trackId: string): boolean {
    const region = getLayoutRegionForColumn(columnIndex)
    return region?.slots?.includes(trackId) ?? false
  }

  /** Get slot index for a track in the region containing a column */
  function getTrackSlotIndex(columnIndex: number, trackId: string): number | null {
    const region = getLayoutRegionForColumn(columnIndex)
    const index = region?.slots?.indexOf(trackId) ?? -1
    return index >= 0 ? index : null
  }

  /** Set the layout type for a region containing a column */
  function setRegionLayout(columnIndex: number, layoutType: string) {
    const region = getLayoutRegionForColumn(columnIndex)
    if (!region) return

    const groupIndex = project.groups.findIndex(g => g.id === region.groupId)
    if (groupIndex === -1) return

    setProject('groups', groupIndex, 'layout', typeToLayout(layoutType))
  }

  /**********************************************************************************/
  /*                                                                                */
  /*                               Track Actions                                    */
  /*                                                                                */
  /**********************************************************************************/

  function addTrack(name?: string) {
    const id = `track-${generateId()}`
    const track: Track = {
      id,
      name: name ?? `Track ${project.tracks.length + 1}`,
      clipIds: [],
    }
    setProject('tracks', tracks => [...tracks, track])
    return id
  }

  function removeTrack(trackId: string) {
    // Don't allow removing the layout track
    if (trackId === LAYOUT_TRACK_ID) return

    const track = project.tracks.find(t => t.id === trackId)

    // Remove track's clips from project.clips
    if (track) {
      const clipIdsToRemove = new Set(track.clipIds)
      setProject('clips', clips => clips.filter(c => !clipIdsToRemove.has(c.id)))
    }

    // Remove from project.tracks
    setProject('tracks', tracks => tracks.filter(t => t.id !== trackId))

    // Remove from all layout groups
    setProject('groups', produce((groups: Group[]) => {
      for (const group of groups) {
        group.members = group.members.map(m =>
          'id' in m && m.id === trackId ? { type: 'void' } : m
        )
      }
    }))
  }

  function renameTrack(trackId: string, name: string) {
    setProject('tracks', t => t.id === trackId, 'name', name)
  }

  /**********************************************************************************/
  /*                                                                                */
  /*                              Playback Actions                                  */
  /*                                                                                */
  /**********************************************************************************/

  function play() {
    setIsPlaying(true)
  }

  function pause() {
    setIsPlaying(false)
  }

  function stop() {
    setIsPlaying(false)
    setCurrentTime(0)
  }

  function togglePlay() {
    setIsPlaying(p => !p)
  }

  function seek(time: number) {
    setCurrentTime(Math.max(0, Math.min(time, duration())))
  }

  function seekToColumn(index: number) {
    const boundaries = columnBoundaries()
    if (index >= 0 && index < boundaries.length - 1) {
      seek(boundaries[index])
    }
  }

  /**********************************************************************************/
  /*                                                                                */
  /*                                 Metadata Actions                               */
  /*                                                                                */
  /**********************************************************************************/

  function setBpm(bpm: number) {
    setMetadata('bpm', Math.max(20, Math.min(300, bpm)))
    // Also update project BPM (scaled by 100)
    setProject('bpm', Math.max(20, Math.min(300, bpm)) * 100)
  }

  /** Get content tracks (excluding layout track) */
  const contentTracks = createMemo(() =>
    project.tracks.filter(t => t.id !== LAYOUT_TRACK_ID)
  )

  /**********************************************************************************/
  /*                                                                                */
  /*                                  Public API                                    */
  /*                                                                                */
  /**********************************************************************************/

  return {
    // State
    project,
    metadata,
    trackVideos,
    timeline,
    duration,
    currentTime,
    isPlaying,
    loop,
    orientation,
    selectedColumnIndex,
    selectedLayoutRegion,
    currentColumnIndex,
    columnBoundaries,
    columnDurationMs,
    contentTracks,
    layoutRegions,

    // Column actions
    addColumn,
    removeColumn,
    setColumnDuration,
    selectColumn: setSelectedColumnIndex,

    // Layout region actions
    getLayoutRegionForColumn,
    getRegionPosition,
    findLayoutRegionIndex,
    setLayoutRegion,
    removeLayoutRegion,
    setRegionLayout,
    assignSlotInRegion,
    isTrackInColumn,
    getTrackSlotIndex,
    getSlotCount: (layout: JamLayoutType) => getSlotCount(layout),

    // Clip actions
    toggleClipAtColumn,
    getClipPosition,
    getClipAtColumn,
    hasClipAtColumn,
    createClipAtColumn,
    removeClipAtColumn,
    extendClipToColumn,
    setClipSpan,
    startPaintSession,
    endPaintSession,
    getTracksWithClipsInColumn,
    getValidLayoutsForColumn,

    // Track actions
    addTrack,
    removeTrack,
    renameTrack,

    // Track video actions
    getTrackVideoUrl: (trackId: string) => trackVideos[trackId],
    setTrackVideoUrl: (trackId: string, url: string) => setTrackVideos(trackId, url),

    // Playback actions
    play,
    pause,
    stop,
    togglePlay,
    seek,
    seekToColumn,
    setLoop,

    // Metadata actions
    setBpm,
  }
}

export type Jam = ReturnType<typeof createJam>
