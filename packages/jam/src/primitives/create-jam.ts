/**
 * Create Jam
 *
 * State management for the Jam app.
 * Uses musical time domain (bars) for clips.
 * Tracks reference clips by ID; clips stored at project level.
 */

import type { Accessor } from 'solid-js'
import { createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import type {
  JamColumnDuration,
  JamLayoutRegion,
  JamLayoutType,
  JamMetadata,
  MusicalClip,
  MusicalProject,
  Track,
} from '@eddy/lexicons'
import type { CompiledTimeline } from '@eddy/timeline'
import { compileJamTimeline, getSlotCount } from './compile-jam-timeline'

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

/** Cell state in the sequencer grid */
export interface CellState {
  trackId: string
  columnIndex: number
  active: boolean
  slotIndex: number | null
}

/** Clip position within cell */
export type ClipPosition = 'none' | 'start' | 'middle' | 'end' | 'single'

/** Info about a clip's span across columns */
export interface ClipSpan {
  clipId: string
  trackId: string
  startColumn: number
  endColumn: number // exclusive
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
    groups: [],
    tracks: [
      { id: 'track-0', name: 'Track 1', clipIds: ['clip-0-a'] },
      { id: 'track-1', name: 'Track 2', clipIds: ['clip-1-a', 'clip-1-b'] },
      { id: 'track-2', name: 'Track 3', clipIds: ['clip-2-a'] },
      { id: 'track-3', name: 'Track 4', clipIds: [] },
    ],
    clips: [
      { id: 'clip-0-a', bar: 0, bars: 3 },     // Spans 3 columns
      { id: 'clip-1-a', bar: 1, bars: 1 },     // Single column
      { id: 'clip-1-b', bar: 2.5, bars: 1 },   // Single column (half bar offset)
      { id: 'clip-2-a', bar: 2, bars: 2 },     // Spans 2 columns
    ],
    createdAt: new Date().toISOString(),
  }
}

function makeDefaultMetadata(): JamMetadata {
  return {
    bpm: 120,
    columnCount: 8,
    columnDuration: '1',
    layoutRegions: [
      { id: 'region-0', startColumn: 0, endColumn: 1, layout: 'full', slots: ['track-0'] },
      { id: 'region-1', startColumn: 1, endColumn: 2, layout: '2x2', slots: ['track-0', 'track-1', 'track-2', 'track-3'] },
      { id: 'region-2', startColumn: 2, endColumn: 4, layout: 'h-split', slots: ['track-0', 'track-1'] },
      { id: 'region-3', startColumn: 4, endColumn: 6, layout: 'pip', slots: ['track-0', 'track-1'] },
      { id: 'region-4', startColumn: 6, endColumn: 8, layout: '3-up', slots: ['track-0', 'track-1', 'track-2'] },
    ],
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
    originalClips: Array<{ id: string; bar: number; bars: number }>
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
    compileJamTimeline({
      project,
      metadata,
      canvasSize,
    })
  )

  const duration = createMemo(() => timeline().duration)

  /** Get duration of a single column in bars */
  const columnDurationBars = createMemo(() => parseDuration(metadata.columnDuration))

  /** Get duration of a single column in milliseconds */
  const columnDurationMs = createMemo(() => {
    const barMs = (60 / metadata.bpm) * 4 * 1000 // 4 beats per bar
    return columnDurationBars() * barMs
  })

  /** Get column boundaries in bars (for clip comparison) */
  const columnBoundariesBars = createMemo(() => {
    const boundaries: number[] = []
    const colDuration = columnDurationBars()
    for (let i = 0; i <= metadata.columnCount; i++) {
      boundaries.push(i * colDuration)
    }
    return boundaries
  })

  /** Get column boundaries in seconds (for playback) */
  const columnBoundaries = createMemo(() =>
    columnBoundariesBars().map(bars => barsToSeconds(bars))
  )

  const currentColumnIndex = createMemo(() => {
    const time = currentTime()
    const colDuration = columnDurationMs() / 1000
    return Math.min(Math.floor(time / colDuration), metadata.columnCount - 1)
  })

  /** Convert bars to seconds */
  function barsToSeconds(bars: number): number {
    const barSec = (60 / metadata.bpm) * 4 // 4 beats per bar
    return bars * barSec
  }

  /** Get the layout region for a given column */
  const getLayoutRegionForColumn = (columnIndex: number): JamLayoutRegion | null => {
    return metadata.layoutRegions.find(
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

    const boundaries = columnBoundariesBars()
    const columnStartBar = boundaries[columnIndex]
    const columnEndBar = boundaries[columnIndex + 1]
    if (columnStartBar === undefined || columnEndBar === undefined) return null

    for (const clipId of track.clipIds) {
      const clip = getClipById(clipId)
      if (!clip) continue

      const clipStart = clip.bar
      const clipEnd = clip.bar + clip.bars

      // Check if clip overlaps this column
      if (clipStart < columnEndBar && clipEnd > columnStartBar) {
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

    const boundaries = columnBoundariesBars()
    const columnStartBar = boundaries[columnIndex]
    const columnEndBar = boundaries[columnIndex + 1]

    const clipStart = clip.bar
    const clipEnd = clip.bar + clip.bars

    const startsInColumn = clipStart >= columnStartBar && clipStart < columnEndBar
    const endsInColumn = clipEnd > columnStartBar && clipEnd <= columnEndBar

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
    const boundaries = columnBoundariesBars()
    const columnStartBar = boundaries[columnIndex]
    const columnEndBar = boundaries[columnIndex + 1]
    if (columnStartBar === undefined || columnEndBar === undefined) return ''

    const clipId = `clip-${generateId()}`
    const newClip: MusicalClip = {
      id: clipId,
      bar: columnStartBar,
      bars: columnEndBar - columnStartBar,
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

    const boundaries = columnBoundariesBars()
    const clip = getClipById(clipInfo.clipId)
    if (!clip) return

    const targetColumnEndBar = boundaries[toColumnIndex + 1]
    const targetColumnStartBar = boundaries[toColumnIndex]
    if (targetColumnEndBar === undefined || targetColumnStartBar === undefined) return

    // Extend clip end or start depending on direction
    if (toColumnIndex > fromColumnIndex) {
      // Extending forward
      const newEnd = targetColumnEndBar
      setProject(
        'clips',
        clipInfo.clipIndex,
        'bars',
        newEnd - clip.bar
      )
    } else {
      // Extending backward
      const newStart = targetColumnStartBar
      const newDuration = (clip.bar + clip.bars) - newStart
      setProject(
        'clips',
        clipInfo.clipIndex,
        produce(c => {
          c.bar = newStart
          c.bars = newDuration
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
        bar: c.bar,
        bars: c.bars,
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

    const boundaries = columnBoundariesBars()
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
        c.bar = newStart
        c.bars = newEnd - newStart
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

      const originalStart = original.bar
      const originalEnd = original.bar + original.bars

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
        const currentStart = clip.bar
        const currentEnd = clip.bar + clip.bars

        if (newClipStart !== currentStart || newClipEnd !== currentEnd) {
          setProject(
            'clips',
            clipIndex,
            produce(c => {
              c.bar = newClipStart
              c.bars = Math.max(0, newClipEnd - newClipStart)
            })
          )
        }
      } else {
        // No overlap - restore to original if it was changed
        const currentStart = clip.bar
        const currentEnd = clip.bar + clip.bars

        if (currentStart !== originalStart || currentEnd !== originalEnd) {
          setProject(
            'clips',
            clipIndex,
            produce(c => {
              c.bar = originalStart
              c.bars = original.bars
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

    // Shrink any layout regions that extend past the new column count
    setMetadata('layoutRegions', regions =>
      regions
        .map(region => {
          if (region.endColumn > lastColumn) {
            return { ...region, endColumn: lastColumn }
          }
          return region
        })
        .filter(region => region.startColumn < lastColumn)
    )

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

  /** Find the index of the layout region containing a column */
  function findLayoutRegionIndex(columnIndex: number): number {
    return metadata.layoutRegions.findIndex(
      region => columnIndex >= region.startColumn && columnIndex < region.endColumn
    )
  }

  /** Create or update a layout region for a range of columns */
  function setLayoutRegion(startColumn: number, endColumn: number, layout: JamLayoutType) {
    // Remove any existing regions that overlap with this range
    const newRegions = metadata.layoutRegions.filter(
      region => region.endColumn <= startColumn || region.startColumn >= endColumn
    )

    // Add the new region
    const newRegion: JamLayoutRegion = {
      id: `region-${generateId()}`,
      startColumn,
      endColumn,
      layout,
      slots: [],
    }

    // Insert in sorted order by startColumn
    const insertIndex = newRegions.findIndex(r => r.startColumn > startColumn)
    if (insertIndex === -1) {
      newRegions.push(newRegion)
    } else {
      newRegions.splice(insertIndex, 0, newRegion)
    }

    setMetadata('layoutRegions', newRegions)
  }

  /** Remove layout region at column (merges with adjacent or creates gap) */
  function removeLayoutRegion(columnIndex: number) {
    const regionIndex = findLayoutRegionIndex(columnIndex)
    if (regionIndex === -1) return

    setMetadata('layoutRegions', regions => regions.filter((_, i) => i !== regionIndex))
  }

  /** Assign a slot in a layout region */
  function assignSlotInRegion(regionIndex: number, slotIndex: number, trackId: string | null) {
    if (regionIndex < 0 || regionIndex >= metadata.layoutRegions.length) return

    setMetadata('layoutRegions', regionIndex, produce((region: JamLayoutRegion) => {
      if (!region.slots) {
        region.slots = []
      }

      // Ensure array is large enough
      while (region.slots.length <= slotIndex) {
        region.slots.push('')
      }

      // Remove trackId from any other slot in this region first
      if (trackId) {
        region.slots = region.slots.map(id => (id === trackId ? '' : id))
      }

      // Assign to target slot
      region.slots[slotIndex] = trackId ?? ''
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
  function setRegionLayout(columnIndex: number, layout: JamLayoutType) {
    const regionIndex = findLayoutRegionIndex(columnIndex)
    if (regionIndex === -1) return
    setMetadata('layoutRegions', regionIndex, 'layout', layout)
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
    const track = project.tracks.find(t => t.id === trackId)

    // Remove track's clips from project.clips
    if (track) {
      const clipIdsToRemove = new Set(track.clipIds)
      setProject('clips', clips => clips.filter(c => !clipIdsToRemove.has(c.id)))
    }

    // Remove from project.tracks
    setProject('tracks', tracks => tracks.filter(t => t.id !== trackId))

    // Remove from all layout region slots
    setMetadata('layoutRegions', produce((regions: JamLayoutRegion[]) => {
      for (const region of regions) {
        if (region.slots) {
          region.slots = region.slots.map(id => (id === trackId ? '' : id))
        }
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
  }

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
