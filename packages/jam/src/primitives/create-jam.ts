/**
 * Create Jam
 *
 * State management for the Jam app.
 * Manages project + columns, edit actions, and playback coordination.
 */

import type { Accessor } from 'solid-js'
import { createEffect, createMemo, createSignal, on, onCleanup } from 'solid-js'
import { createStore, produce } from 'solid-js/store'
import type {
  JamColumn,
  JamColumnDuration,
  JamLayoutType,
  JamMetadata,
  Project,
  Track,
} from '@eddy/lexicons'
import type { CompiledTimeline } from '@eddy/timeline'
import {
  compileJamTimeline,
  findColumnAtTime,
  getSlotCount,
  calculateColumnBoundaries,
} from './compile-jam-timeline'

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

export interface CreateJamOptions {
  /** Initial project data */
  initialProject?: Project
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

function makeDefaultProject(): Project {
  // At 120 BPM, 1 bar = 2 seconds = 2000ms
  const barMs = 2000
  return {
    schemaVersion: 1,
    title: 'Jam Session',
    canvas: { width: 640, height: 360 },
    groups: [],
    tracks: [
      {
        id: 'track-0',
        name: 'Track 1',
        clips: [
          { id: 'clip-0-a', offset: 0, duration: barMs * 3 }, // Spans 3 columns
        ],
      },
      {
        id: 'track-1',
        name: 'Track 2',
        clips: [
          { id: 'clip-1-a', offset: barMs, duration: barMs }, // Single column
          { id: 'clip-1-b', offset: barMs * 2.5, duration: barMs }, // Single column (half bar offset)
        ],
      },
      {
        id: 'track-2',
        name: 'Track 3',
        clips: [
          { id: 'clip-2-a', offset: barMs * 2, duration: barMs * 2 }, // Spans 2 columns
        ],
      },
      { id: 'track-3', name: 'Track 4', clips: [] },
    ],
    createdAt: new Date().toISOString(),
  }
}

function makeDefaultMetadata(): JamMetadata {
  return {
    bpm: 120,
    columns: [
      { id: 'col-0', duration: '1', layout: 'full', slots: ['track-0'] },
      { id: 'col-1', duration: '1', layout: '2x2', slots: ['track-0', 'track-1', 'track-2', 'track-3'] },
      { id: 'col-2', duration: '1/2', layout: 'h-split', slots: ['track-0', 'track-1'] },
      { id: 'col-3', duration: '1/2', layout: 'v-split', slots: ['track-2', 'track-3'] },
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
  const [project, setProject] = createStore<Project>(
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
      columns: metadata.columns,
      bpm: metadata.bpm,
      canvasSize,
    })
  )

  const duration = createMemo(() => timeline().duration)

  const columnBoundaries = createMemo(() =>
    calculateColumnBoundaries(metadata.columns, metadata.bpm)
  )

  const currentColumnIndex = createMemo(() =>
    findColumnAtTime(metadata.columns, metadata.bpm, currentTime())
  )

  const selectedColumn = createMemo(() => {
    const index = selectedColumnIndex()
    return index !== null ? metadata.columns[index] : null
  })

  // Column boundaries in milliseconds (for clip comparison)
  const columnBoundariesMs = createMemo(() =>
    columnBoundaries().map(sec => sec * 1000)
  )

  /**********************************************************************************/
  /*                                                                                */
  /*                                 Clip Helpers                                   */
  /*                                                                                */
  /**********************************************************************************/

  /** Find which clip (if any) overlaps a given column for a track */
  function getClipAtColumn(trackId: string, columnIndex: number): { clipId: string; clipIndex: number } | null {
    const track = project.tracks.find(t => t.id === trackId)
    if (!track) return null

    const boundaries = columnBoundariesMs()
    const columnStartMs = boundaries[columnIndex]
    const columnEndMs = boundaries[columnIndex + 1]
    if (columnStartMs === undefined || columnEndMs === undefined) return null

    for (let i = 0; i < track.clips.length; i++) {
      const clip = track.clips[i]
      const clipStart = clip.offset
      const clipEnd = clip.offset + clip.duration

      // Check if clip overlaps this column
      if (clipStart < columnEndMs && clipEnd > columnStartMs) {
        return { clipId: clip.id, clipIndex: i }
      }
    }
    return null
  }

  /** Get the clip position within a cell (for visual styling) */
  function getClipPosition(trackId: string, columnIndex: number): ClipPosition {
    const clipInfo = getClipAtColumn(trackId, columnIndex)
    if (!clipInfo) return 'none'

    const track = project.tracks.find(t => t.id === trackId)
    const clip = track?.clips[clipInfo.clipIndex]
    if (!clip) return 'none'

    const boundaries = columnBoundariesMs()
    const columnStartMs = boundaries[columnIndex]
    const columnEndMs = boundaries[columnIndex + 1]

    const clipStart = clip.offset
    const clipEnd = clip.offset + clip.duration

    const startsInColumn = clipStart >= columnStartMs && clipStart < columnEndMs
    const endsInColumn = clipEnd > columnStartMs && clipEnd <= columnEndMs

    if (startsInColumn && endsInColumn) return 'single'
    if (startsInColumn) return 'start'
    if (endsInColumn) return 'end'
    return 'middle'
  }

  /** Check if a track has any clip content at a column */
  function hasClipAtColumn(trackId: string, columnIndex: number): boolean {
    return getClipAtColumn(trackId, columnIndex) !== null
  }

  /** Create a new clip at a column */
  function createClipAtColumn(trackId: string, columnIndex: number): string {
    const boundaries = columnBoundariesMs()
    const columnStartMs = boundaries[columnIndex]
    const columnEndMs = boundaries[columnIndex + 1]
    if (columnStartMs === undefined || columnEndMs === undefined) return ''

    const clipId = `clip-${generateId()}`
    const newClip = {
      id: clipId,
      offset: columnStartMs,
      duration: columnEndMs - columnStartMs,
    }

    setProject(
      'tracks',
      track => track.id === trackId,
      'clips',
      clips => [...clips, newClip]
    )

    return clipId
  }

  /** Remove clip at a column */
  function removeClipAtColumn(trackId: string, columnIndex: number) {
    const clipInfo = getClipAtColumn(trackId, columnIndex)
    if (!clipInfo) return

    setProject(
      'tracks',
      track => track.id === trackId,
      'clips',
      clips => clips.filter(c => c.id !== clipInfo.clipId)
    )
  }

  /** Extend a clip to include an additional column */
  function extendClipToColumn(trackId: string, fromColumnIndex: number, toColumnIndex: number) {
    const clipInfo = getClipAtColumn(trackId, fromColumnIndex)
    if (!clipInfo) return

    const boundaries = columnBoundariesMs()
    const track = project.tracks.find(t => t.id === trackId)
    const clip = track?.clips[clipInfo.clipIndex]
    if (!clip) return

    const targetColumnEnd = boundaries[toColumnIndex + 1]
    const targetColumnStart = boundaries[toColumnIndex]
    if (targetColumnEnd === undefined || targetColumnStart === undefined) return

    // Extend clip end or start depending on direction
    if (toColumnIndex > fromColumnIndex) {
      // Extending forward
      const newEnd = targetColumnEnd
      setProject(
        'tracks',
        t => t.id === trackId,
        'clips',
        clipInfo.clipIndex,
        'duration',
        newEnd - clip.offset
      )
    } else {
      // Extending backward
      const newStart = targetColumnStart
      const newDuration = (clip.offset + clip.duration) - newStart
      setProject(
        'tracks',
        t => t.id === trackId,
        'clips',
        clipInfo.clipIndex,
        produce(c => {
          c.offset = newStart
          c.duration = newDuration
        })
      )
    }
  }

  /** Toggle clip at column - create if none, remove if clicking on start/single, extend if adjacent */
  function toggleClipAtColumn(columnIndex: number, trackId: string) {
    const position = getClipPosition(trackId, columnIndex)

    if (position === 'none') {
      // Check if adjacent column has a clip we can extend
      const prevPosition = columnIndex > 0 ? getClipPosition(trackId, columnIndex - 1) : 'none'
      const nextPosition = columnIndex < metadata.columns.length - 1 ? getClipPosition(trackId, columnIndex + 1) : 'none'

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

  function addColumn(afterIndex?: number) {
    const newColumn: JamColumn = {
      id: `col-${generateId()}`,
      duration: '1',
      layout: 'full',
      slots: [],
    }

    setMetadata('columns', columns => {
      const index = afterIndex !== undefined ? afterIndex + 1 : columns.length
      return [...columns.slice(0, index), newColumn, ...columns.slice(index)]
    })

    return newColumn.id
  }

  function removeColumn(index: number) {
    if (metadata.columns.length <= 1) return // Keep at least one column

    setMetadata('columns', columns => columns.filter((_, i) => i !== index))

    // Adjust selection if needed
    if (selectedColumnIndex() === index) {
      setSelectedColumnIndex(null)
    } else if (selectedColumnIndex() !== null && selectedColumnIndex()! > index) {
      setSelectedColumnIndex(i => i! - 1)
    }
  }

  function setColumnDuration(index: number, duration: JamColumnDuration) {
    setMetadata('columns', index, 'duration', duration)
  }

  function setColumnLayout(index: number, layout: JamLayoutType) {
    // Keep all slots - excess slots beyond layout's slot count become inactive
    // but are preserved in case user switches to a larger layout
    setMetadata('columns', index, 'layout', layout)
  }

  /**********************************************************************************/
  /*                                                                                */
  /*                                 Slot Actions                                   */
  /*                                                                                */
  /**********************************************************************************/

  function assignSlot(columnIndex: number, slotIndex: number, trackId: string | null) {
    setMetadata('columns', columnIndex, produce((column: JamColumn) => {
      if (!column.slots) {
        column.slots = []
      }

      // Ensure array is large enough
      while (column.slots.length <= slotIndex) {
        column.slots.push('')
      }

      // Remove trackId from any other slot in this column first
      if (trackId) {
        column.slots = column.slots.map(id => (id === trackId ? '' : id))
      }

      // Assign to target slot
      column.slots[slotIndex] = trackId ?? ''
    }))
  }

  function clearSlot(columnIndex: number, slotIndex: number) {
    assignSlot(columnIndex, slotIndex, null)
  }

  /** Toggle a track's presence in a column (for grid painting) */
  function toggleTrackInColumn(columnIndex: number, trackId: string) {
    const column = metadata.columns[columnIndex]
    if (!column) return

    const slots = column.slots ?? []
    const existingSlotIndex = slots.indexOf(trackId)

    if (existingSlotIndex >= 0) {
      // Track is in column - remove it
      clearSlot(columnIndex, existingSlotIndex)
    } else {
      // Track not in column - add to first empty slot
      const maxSlots = getSlotCount(column.layout)
      const emptySlotIndex = slots.findIndex((id, i) => i < maxSlots && !id)

      if (emptySlotIndex >= 0) {
        assignSlot(columnIndex, emptySlotIndex, trackId)
      } else if (slots.length < maxSlots) {
        assignSlot(columnIndex, slots.length, trackId)
      }
      // If no empty slots, do nothing
    }
  }

  /** Check if a track is active in a column */
  function isTrackInColumn(columnIndex: number, trackId: string): boolean {
    const column = metadata.columns[columnIndex]
    return column?.slots?.includes(trackId) ?? false
  }

  /** Check if a track continues from the previous column */
  function trackContinuesFromPrevious(columnIndex: number, trackId: string): boolean {
    if (columnIndex <= 0) return false
    return isTrackInColumn(columnIndex - 1, trackId) && isTrackInColumn(columnIndex, trackId)
  }

  /** Check if a track continues to the next column */
  function trackContinuesToNext(columnIndex: number, trackId: string): boolean {
    if (columnIndex >= metadata.columns.length - 1) return false
    return isTrackInColumn(columnIndex, trackId) && isTrackInColumn(columnIndex + 1, trackId)
  }

  /** Get slot index for a track in a column (or null if not present) */
  function getTrackSlotIndex(columnIndex: number, trackId: string): number | null {
    const column = metadata.columns[columnIndex]
    const index = column?.slots?.indexOf(trackId) ?? -1
    return index >= 0 ? index : null
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
      clips: [],
    }
    setProject('tracks', tracks => [...tracks, track])
    return id
  }

  function removeTrack(trackId: string) {
    // Remove from project
    setProject('tracks', tracks => tracks.filter(t => t.id !== trackId))

    // Remove from all column slots
    setMetadata('columns', produce((columns: JamColumn[]) => {
      for (const column of columns) {
        if (column.slots) {
          column.slots = column.slots.map(id => (id === trackId ? '' : id))
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
    selectedColumn,
    currentColumnIndex,
    columnBoundaries,

    // Column actions
    addColumn,
    removeColumn,
    setColumnDuration,
    setColumnLayout,
    selectColumn: setSelectedColumnIndex,

    // Slot actions
    assignSlot,
    clearSlot,
    toggleTrackInColumn,
    isTrackInColumn,
    getTrackSlotIndex,
    getSlotCount: (layout: JamLayoutType) => getSlotCount(layout),

    // Clip actions
    toggleClipAtColumn,
    getClipPosition,
    hasClipAtColumn,
    createClipAtColumn,
    removeClipAtColumn,
    extendClipToColumn,

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
