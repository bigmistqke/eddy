/**
 * Create Jam
 *
 * State management for the Jam app.
 * Uses musical time domain (ticks) for clips.
 * Layout regions are clips on a metadata track with source.type='layout'.
 */

import type {
  Clip,
  ClipLayout,
  ClipUrl,
  JamColumnDuration,
  JamLayoutType,
  JamMetadata,
  LayoutTrack,
  MediaTrack,
  MusicalProject,
} from '@eddy/lexicons'
import { getProjectDuration, musicalToAbsolute } from '@eddy/timeline'
import { createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'
import { createStore, produce } from 'solid-js/store'

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
  /** Canvas size for layout calculations */
  canvasSize: { width: number; height: number }
}

/** Clip position within cell */
export type ClipPosition = 'none' | 'start' | 'middle' | 'end' | 'single'

/** Layout region derived from layout track clip */
export interface LayoutRegion {
  clipId: string
  startTick: number
  endTick: number
  startColumn: number
  endColumn: number
  clip: ClipLayout
}

/**********************************************************************************/
/*                                                                                */
/*                                   Defaults                                     */
/*                                                                                */
/**********************************************************************************/

function makeDefaultProject(): MusicalProject {
  return {
    type: 'musical',
    schemaVersion: 1,
    title: 'Jam Session',
    canvas: { width: 640, height: 360 },
    bpm: 12000, // 120 BPM (scaled by 100)
    ppq: DEFAULT_PPQ,
    mediaTracks: [
      // Content tracks with inline clips
      {
        id: 'track-0',
        name: 'Track 1',
        clips: [
          {
            id: 'clip-0',
            start: 0,
            duration: TICKS_PER_BAR * 3,
            type: 'url',
            url: '/videos/big-buck-bunny.webm',
          },
        ],
      },
      {
        id: 'track-1',
        name: 'Track 2',
        clips: [
          {
            id: 'clip-1a',
            start: TICKS_PER_BAR,
            duration: TICKS_PER_BAR,
            type: 'url',
            url: '/videos/sample-5s.webm',
          },
          {
            id: 'clip-1b',
            start: TICKS_PER_BAR * 2 + TICKS_PER_BAR / 2,
            duration: TICKS_PER_BAR,
            type: 'url',
            url: '/videos/sample-5s.webm',
          },
        ],
      },
      {
        id: 'track-2',
        name: 'Track 3',
        clips: [
          {
            id: 'clip-2',
            start: TICKS_PER_BAR * 2,
            duration: TICKS_PER_BAR * 2,
            type: 'url',
            url: '/videos/sample-10s.webm',
          },
        ],
      },
      {
        id: 'track-3',
        name: 'Track 4',
        clips: [],
      },
    ],
    metadataTracks: [
      // Layout track - clips define layout regions directly
      {
        id: LAYOUT_TRACK_ID,
        name: 'Layout',
        clips: [
          {
            type: 'layout',
            id: 'clip-layout-0',
            start: TICKS_PER_BAR * 0,
            duration: TICKS_PER_BAR,
            mode: 'grid',
            slots: ['track-0'],
            columns: 1,
            rows: 1,
          },
          {
            type: 'layout',
            id: 'clip-layout-1',
            start: TICKS_PER_BAR * 1,
            duration: TICKS_PER_BAR,
            mode: 'grid',
            slots: ['track-0', 'track-1', 'track-2', 'track-3'],
            columns: 2,
            rows: 2,
          },
          {
            type: 'layout',
            id: 'clip-layout-2',
            start: TICKS_PER_BAR * 2,
            duration: TICKS_PER_BAR,
            mode: 'grid',
            slots: ['track-0', 'track-1'],
            columns: 2,
            rows: 1,
          },
          {
            type: 'layout',
            id: 'clip-layout-3',
            start: TICKS_PER_BAR * 3,
            duration: TICKS_PER_BAR,
            mode: 'grid',
            slots: ['track-0', 'track-1'],
            columns: 2,
            rows: 1,
          },
          {
            type: 'layout',
            id: 'clip-layout-4',
            start: TICKS_PER_BAR * 4,
            duration: TICKS_PER_BAR,
            mode: 'grid',
            slots: ['track-0', 'track-1', 'track-2'],
            columns: 2,
            rows: 2,
          },
        ],
      } satisfies LayoutTrack,
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
    options.initialProject ?? makeDefaultProject(),
  )
  const [metadata, setMetadata] = createStore<JamMetadata>(
    options.initialMetadata ?? makeDefaultMetadata(),
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
    originalClips: Array<{ id: string; start: number; duration: number }>
  } | null = null
  const [orientation, setOrientation] = createSignal<'portrait' | 'landscape'>(
    window.innerHeight > window.innerWidth ? 'portrait' : 'landscape',
  )

  // Listen for orientation changes
  const handleResize = () => {
    setOrientation(window.innerHeight > window.innerWidth ? 'portrait' : 'landscape')
  }
  window.addEventListener('resize', handleResize)
  onCleanup(() => window.removeEventListener('resize', handleResize))

  // Derived state - convert to absolute for duration calculation
  const duration = createMemo(() => {
    const absoluteProject = musicalToAbsolute(project)
    return getProjectDuration(absoluteProject) / 1000 // Convert ms to seconds
  })

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
    columnBoundariesTicks().map(ticks => ticksToSeconds(ticks)),
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

  /** Get layout track from metadataTracks */
  const layoutTrack = createMemo(() =>
    (project.metadataTracks ?? []).find(t => t.id === LAYOUT_TRACK_ID),
  )

  /** Get all layout regions derived from layout track clips */
  const layoutRegions = createMemo((): LayoutRegion[] => {
    const track = layoutTrack()
    if (!track) return []

    const boundaries = columnBoundariesTicks()
    const regions: LayoutRegion[] = []

    for (const clip of track.clips) {
      if (clip.type !== 'layout') continue

      const startTick = clip.start
      const endTick = clip.start + (clip.duration ?? 0)

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

      regions.push({
        clipId: clip.id,
        startTick,
        endTick,
        startColumn,
        endColumn,
        clip: clip,
      })
    }

    return regions.sort((a, b) => a.startTick - b.startTick)
  })

  /** Get the layout region for a given column */
  function getLayoutRegionForColumn(columnIndex: number): LayoutRegion | null {
    return (
      layoutRegions().find(
        region => columnIndex >= region.startColumn && columnIndex < region.endColumn,
      ) ?? null
    )
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

  /** Get clips for a media track (clips are inline) */
  function getClipsForTrack(trackId: string): Clip[] {
    const track = project.mediaTracks.find(t => t.id === trackId)
    return track?.clips ?? []
  }

  /** Find media track containing a clip */
  function findTrackContainingClip(
    clipId: string,
  ): { track: MediaTrack; clipIndex: number } | null {
    for (const track of project.mediaTracks) {
      const clipIndex = track.clips.findIndex(c => c.id === clipId)
      if (clipIndex !== -1) {
        return { track, clipIndex }
      }
    }
    return null
  }

  /** Find clip by ID in media tracks */
  function getClipById(clipId: string): Clip | undefined {
    for (const track of project.mediaTracks) {
      const clip = track.clips.find(c => c.id === clipId)
      if (clip) return clip
    }
    return undefined
  }

  /** Find track index and clip index for a clip */
  function getClipLocation(clipId: string): { trackIndex: number; clipIndex: number } | null {
    for (let trackIndex = 0; trackIndex < project.mediaTracks.length; trackIndex++) {
      const track = project.mediaTracks[trackIndex]
      const clipIndex = track.clips.findIndex(c => c.id === clipId)
      if (clipIndex !== -1) {
        return { trackIndex, clipIndex }
      }
    }
    return null
  }

  /**********************************************************************************/
  /*                                                                                */
  /*                                 Clip Helpers                                   */
  /*                                                                                */
  /**********************************************************************************/

  /** Find which clip (if any) overlaps a given column for a track */
  function getClipAtColumn(
    trackId: string,
    columnIndex: number,
  ): { clipId: string; trackIndex: number; clipIndex: number } | null {
    const trackIndex = project.mediaTracks.findIndex(t => t.id === trackId)
    if (trackIndex === -1) return null

    const track = project.mediaTracks[trackIndex]
    const boundaries = columnBoundariesTicks()
    const columnStartTick = boundaries[columnIndex]
    const columnEndTick = boundaries[columnIndex + 1]
    if (columnStartTick === undefined || columnEndTick === undefined) return null

    for (let clipIndex = 0; clipIndex < track.clips.length; clipIndex++) {
      const clip = track.clips[clipIndex]
      const clipStart = clip.start
      const clipEnd = clip.start + (clip.duration ?? 0)

      // Check if clip overlaps this column
      if (clipStart < columnEndTick && clipEnd > columnStartTick) {
        return { clipId: clip.id, trackIndex, clipIndex }
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

    const clipStart = clip.start
    const clipEnd = clip.start + (clip.duration ?? 0)

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
    return project.mediaTracks
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
    const trackIndex = project.mediaTracks.findIndex(t => t.id === trackId)
    if (trackIndex === -1) return ''

    const boundaries = columnBoundariesTicks()
    const columnStartTick = boundaries[columnIndex]
    const columnEndTick = boundaries[columnIndex + 1]
    if (columnStartTick === undefined || columnEndTick === undefined) return ''

    const clipId = `clip-${generateId()}`
    const newClip: Clip = {
      id: clipId,
      start: columnStartTick,
      duration: columnEndTick - columnStartTick,
      type: 'url',
      url: '',
    }

    // Add clip directly to track's clips array
    setProject(
      'mediaTracks',
      trackIndex,
      'clips',
      produce(clips => [...clips, newClip]),
    )

    return clipId
  }

  /** Remove clip at a column */
  function removeClipAtColumn(trackId: string, columnIndex: number) {
    const clipInfo = getClipAtColumn(trackId, columnIndex)
    if (!clipInfo) return

    // Remove clip from track's clips array
    setProject('mediaTracks', clipInfo.trackIndex, 'clips', clips =>
      clips.filter(c => c.id !== clipInfo.clipId),
    )
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
        'mediaTracks',
        clipInfo.trackIndex,
        'clips',
        clipInfo.clipIndex,
        'duration',
        newEnd - clip.start,
      )
    } else {
      // Extending backward
      const newStart = targetColumnStartTick
      const newDuration = clip.start + (clip.duration ?? 0) - newStart
      setProject(
        'mediaTracks',
        clipInfo.trackIndex,
        'clips',
        clipInfo.clipIndex,
        produce(c => {
          c.start = newStart
          c.duration = newDuration
        }),
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
        start: c.start,
        duration: c.duration ?? 0,
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
      'mediaTracks',
      clipInfo.trackIndex,
      'clips',
      clipInfo.clipIndex,
      produce(c => {
        c.start = newStart
        c.duration = newEnd - newStart
      }),
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
    paintedEnd: number,
  ) {
    if (!paintSession) return

    const trackIndex = project.mediaTracks.findIndex(t => t.id === trackId)
    if (trackIndex === -1) return

    const track = project.mediaTracks[trackIndex]

    for (let clipIndex = 0; clipIndex < track.clips.length; clipIndex++) {
      const clip = track.clips[clipIndex]
      if (clip.id === paintedClipId) continue

      const original = paintSession.originalClips.find(c => c.id === clip.id)
      if (!original) continue

      const originalStart = original.start
      const originalEnd = original.start + original.duration

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
        const currentStart = clip.start
        const currentEnd = clip.start + (clip.duration ?? 0)

        if (newClipStart !== currentStart || newClipEnd !== currentEnd) {
          setProject(
            'mediaTracks',
            trackIndex,
            'clips',
            clipIndex,
            produce(c => {
              c.start = newClipStart
              c.duration = Math.max(0, newClipEnd - newClipStart)
            }),
          )
        }
      } else {
        // No overlap - restore to original if it was changed
        const currentStart = clip.start
        const currentEnd = clip.start + (clip.duration ?? 0)

        if (currentStart !== originalStart || currentEnd !== originalEnd) {
          setProject(
            'mediaTracks',
            trackIndex,
            'clips',
            clipIndex,
            produce(c => {
              c.start = originalStart
              c.duration = original.duration
            }),
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
      const nextPosition =
        columnIndex < metadata.columnCount - 1 ? getClipPosition(trackId, columnIndex + 1) : 'none'

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
    }),
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

    // Find layout track index
    const layoutTrackIndex = (project.metadataTracks ?? []).findIndex(t => t.id === LAYOUT_TRACK_ID)

    // Shrink any layout clips that extend past the new column count
    if (layoutTrackIndex !== -1) {
      const track = project.metadataTracks![layoutTrackIndex]
      const clipsToRemove: string[] = []

      for (let clipIndex = 0; clipIndex < track.clips.length; clipIndex++) {
        const clip = track.clips[clipIndex]
        const clipEnd = clip.start + (clip.duration ?? 0)

        if (clipEnd > lastColumnEndTick) {
          if (clip.start >= lastColumnEndTick) {
            // Clip starts after new end - mark for removal
            clipsToRemove.push(clip.id)
          } else {
            // Shrink clip to fit
            setProject(
              'metadataTracks',
              layoutTrackIndex,
              'clips',
              clipIndex,
              'duration',
              lastColumnEndTick - clip.start,
            )
          }
        }
      }

      // Remove clips that start after new end
      if (clipsToRemove.length > 0) {
        setProject('metadataTracks', layoutTrackIndex, 'clips', clips =>
          clips.filter(c => !clipsToRemove.includes(c.id)),
        )
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
      region => columnIndex >= region.startColumn && columnIndex < region.endColumn,
    )
  }

  // /** Get layout type string from layout source */
  // function layoutSourceToType(source: ClipSourceLayout): string {
  //   const { mode, columns, rows } = source
  //   if (mode === 'pip') return 'pip'
  //   if (mode === 'split') return 'h-split'
  //   if (mode === 'focus') return 'full'
  //   // Grid mode - determine by dimensions
  //   if (columns === 1 && rows === 1) return 'full'
  //   if (columns === 2 && rows === 1) return 'h-split'
  //   if (columns === 1 && rows === 2) return 'v-split'
  //   if (columns === 2 && rows === 2) return '2x2'
  //   return `${columns}x${rows}`
  // }

  /** Convert layout type string to layout source */
  function typeToLayout(
    type: string,
    config: Pick<ClipLayout, 'start' | 'duration' | 'id'>,
  ): ClipLayout {
    switch (type) {
      case 'full':
        return { type: 'layout', mode: 'focus', slots: [], ...config }
      case 'h-split':
        return { type: 'layout', mode: 'grid', slots: [], columns: 2, rows: 1, ...config }
      case 'v-split':
        return { type: 'layout', mode: 'grid', slots: [], columns: 1, rows: 2, ...config }
      case '2x2':
        return { type: 'layout', mode: 'grid', slots: [], columns: 2, rows: 2, ...config }
      case '3-up':
        return { type: 'layout', mode: 'grid', slots: [], columns: 2, rows: 2, ...config }
      case 'pip':
        return { type: 'layout', mode: 'pip', slots: [], ...config }
      default:
        return { type: 'layout', mode: 'focus', slots: [], ...config }
    }
  }

  /** Create or update a layout region for a range of columns */
  function setLayoutRegion(startColumn: number, endColumn: number, layoutType: string) {
    const boundaries = columnBoundariesTicks()
    const startTick = boundaries[startColumn]
    const endTick = boundaries[endColumn]
    if (startTick === undefined || endTick === undefined) return

    // Find layout track index
    const layoutTrackIndex = (project.metadataTracks ?? []).findIndex(t => t.id === LAYOUT_TRACK_ID)
    if (layoutTrackIndex === -1) return

    const track = project.metadataTracks![layoutTrackIndex]

    // Find overlapping clips to remove
    const clipsToRemove = track.clips
      .filter(clip => {
        const clipEnd = clip.start + (clip.duration ?? 0)
        return clip.start < endTick && clipEnd > startTick
      })
      .map(c => c.id)

    // Remove overlapping clips
    if (clipsToRemove.length > 0) {
      setProject('metadataTracks', layoutTrackIndex, 'clips', clips =>
        clips.filter(c => !clipsToRemove.includes(c.id)),
      )
    }

    // Create new layout clip with layout source directly
    const clipId = `layout-${generateId()}`

    // Convert layout type to source
    const newClip = typeToLayout(layoutType, {
      id: clipId,
      start: startTick,
      duration: endTick - startTick,
    })

    // Add to layout track
    setProject('metadataTracks', layoutTrackIndex, 'clips', clips => [...clips, newClip])
  }

  /** Remove layout region at column */
  function removeLayoutRegion(columnIndex: number) {
    const region = getLayoutRegionForColumn(columnIndex)
    if (!region) return

    // Find layout track index
    const layoutTrackIndex = (project.metadataTracks ?? []).findIndex(t => t.id === LAYOUT_TRACK_ID)
    if (layoutTrackIndex === -1) return

    // Remove the layout clip
    setProject('metadataTracks', layoutTrackIndex, 'clips', clips =>
      clips.filter(c => c.id !== region.clipId),
    )
  }

  /** Assign a slot in a layout region */
  function assignSlotInRegion(regionIndex: number, slotIndex: number, trackId: string | null) {
    const regions = layoutRegions()
    if (regionIndex < 0 || regionIndex >= regions.length) return

    const region = regions[regionIndex]

    // Find layout track and clip indices
    const layoutTrackIndex = (project.metadataTracks ?? []).findIndex(t => t.id === LAYOUT_TRACK_ID)
    if (layoutTrackIndex === -1) return

    const track = project.metadataTracks![layoutTrackIndex]
    const clipIndex = track.clips.findIndex(c => c.id === region.clipId)
    if (clipIndex === -1) return

    const clip = track.clips[clipIndex]
    if (clip.type !== 'layout') return

    // Create updated slots array from current store state
    const currentSlots = [...clip.slots]

    // Ensure slots array is large enough
    while (currentSlots.length <= slotIndex) {
      currentSlots.push('')
    }

    // Remove trackId from any other slot first
    const updatedSlots = trackId
      ? currentSlots.map(slot => (slot === trackId ? '' : slot))
      : currentSlots

    // Assign to target slot
    updatedSlots[slotIndex] = trackId ?? ''

    setProject('metadataTracks', layoutTrackIndex, 'clips', clipIndex, 'slots', updatedSlots)
  }

  /** Check if a track is in the layout region containing a column */
  function isTrackInColumn(columnIndex: number, trackId: string): boolean {
    const region = getLayoutRegionForColumn(columnIndex)
    return region?.clip.slots.includes(trackId) ?? false
  }

  /** Get slot index for a track in the region containing a column */
  function getTrackSlotIndex(columnIndex: number, trackId: string): number | null {
    const region = getLayoutRegionForColumn(columnIndex)
    const index = region?.clip.slots.indexOf(trackId) ?? -1
    return index >= 0 ? index : null
  }

  /** Set the layout type for a region containing a column */
  function setRegionLayout(columnIndex: number, layoutType: string) {
    const region = getLayoutRegionForColumn(columnIndex)
    if (!region) return

    // Find layout track and clip indices
    const layoutTrackIndex = (project.metadataTracks ?? []).findIndex(t => t.id === LAYOUT_TRACK_ID)
    if (layoutTrackIndex === -1) return

    const track = project.metadataTracks![layoutTrackIndex]
    const clipIndex = track.clips.findIndex(c => c.id === region.clipId)
    if (clipIndex === -1) return

    // Get new layout source, preserving existing slots
    const newClip = typeToLayout(layoutType, region.clip)
    newClip.slots = region.clip.slots

    setProject('metadataTracks', layoutTrackIndex, 'clips', clipIndex, newClip)
  }

  /**********************************************************************************/
  /*                                                                                */
  /*                               Track Actions                                    */
  /*                                                                                */
  /**********************************************************************************/

  function addTrack(name?: string, videoUrl?: string) {
    const trackId = `track-${generateId()}`
    const clips: ClipUrl[] = []

    // If a video URL is provided, create a clip that spans the full timeline
    if (videoUrl) {
      const clipId = `clip-${generateId()}`
      const totalTicks = metadata.columnCount * columnDurationTicks()
      clips.push({
        id: clipId,
        start: 0,
        duration: totalTicks,
        type: 'url',
        url: videoUrl,
      })
    }

    const track: MediaTrack = {
      id: trackId,
      name: name ?? `Track ${project.mediaTracks.length + 1}`,
      clips,
    }
    setProject('mediaTracks', tracks => [...tracks, track])
    return trackId
  }

  function removeTrack(trackId: string) {
    // Don't allow removing the layout track
    if (trackId === LAYOUT_TRACK_ID) return

    // Remove from mediaTracks (clips are inline, so they go with the track)
    setProject('mediaTracks', tracks => tracks.filter(t => t.id !== trackId))

    // Remove from all layout clips' slots
    const layoutTrackIndex = (project.metadataTracks ?? []).findIndex(t => t.id === LAYOUT_TRACK_ID)
    if (layoutTrackIndex !== -1) {
      const track = project.metadataTracks![layoutTrackIndex]
      for (let clipIndex = 0; clipIndex < track.clips.length; clipIndex++) {
        const clip = track.clips[clipIndex]
        if (clip.type === 'layout') {
          setProject(
            'metadataTracks',
            layoutTrackIndex,
            'clips',
            clipIndex,
            'slots',
            slot => slot === trackId,
            '',
          )
        }
      }
    }
  }

  function renameTrack(trackId: string, name: string) {
    setProject('mediaTracks', t => t.id === trackId, 'name', name)
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

  /** Get content tracks (all media tracks) */
  const contentTracks = createMemo(() => project.mediaTracks)

  /**********************************************************************************/
  /*                                                                                */
  /*                                  Public API                                    */
  /*                                                                                */
  /**********************************************************************************/

  return {
    // State
    project,
    metadata,
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
