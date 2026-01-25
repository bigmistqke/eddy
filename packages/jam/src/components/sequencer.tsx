/**
 * Grid
 *
 * Main sequencer grid component.
 * Rows = tracks, columns = time segments.
 * Shows clips with connected styling for multi-column spans.
 */

import type { JamLayoutType } from '@eddy/lexicons'
import { Repeat } from '@solid-primitives/range'
import clsx from 'clsx'
import { createSignal, For } from 'solid-js'
import type { ClipPosition, Jam } from '~/primitives/create-jam'
import styles from './Sequencer.module.css'

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

export interface GridProps {
  jam: Jam
}

/**********************************************************************************/
/*                                                                                */
/*                                   Constants                                    */
/*                                                                                */
/**********************************************************************************/

const LAYOUT_ICONS: Record<JamLayoutType, string> = {
  full: '\u2588',
  pip: '\u25a3',
  '2x2': '\u25a6',
  '3-up': '\u25a7',
  'h-split': '\u2550',
  'v-split': '\u2551',
}

const TEST_VIDEOS = [
  '/videos/big-buck-bunny.webm',
  '/videos/sample-5s.webm',
  '/videos/sample-10s.webm',
  '/videos/sample-15s.webm',
]

/**********************************************************************************/
/*                                                                                */
/*                                  Track Label                                   */
/*                                                                                */
/**********************************************************************************/

interface TrackLabelProps {
  name: string
  trackId: string
}

function TrackLabel(props: TrackLabelProps) {
  return (
    <div class={styles.labelContainer}>
      <div class={styles.label}>{props.name}</div>
    </div>
  )
}

/**********************************************************************************/
/*                                                                                */
/*                                      Cell                                      */
/*                                                                                */
/**********************************************************************************/

interface CellProps {
  trackId: string
  columnIndex: number
  clipPosition: ClipPosition
  onToggle: () => void
  onPointerEnter: (event: PointerEvent) => void
}

function Cell(props: CellProps) {
  return (
    <div
      class={styles.cell}
      data-clip={props.clipPosition}
      onPointerDown={event => {
        event.preventDefault()
        props.onToggle()
      }}
      onPointerEnter={event => props.onPointerEnter(event)}
    />
  )
}

/**********************************************************************************/
/*                                                                                */
/*                                      Grid                                      */
/*                                                                                */
/**********************************************************************************/

export function Grid(props: GridProps) {
  const { jam } = props

  const [isPainting, setIsPainting] = createSignal(false)
  const [paintMode, setPaintMode] = createSignal<'add' | 'remove' | null>(null)
  const [paintAnchorColumn, setPaintAnchorColumn] = createSignal<number | null>(null)
  const [paintTrackId, setPaintTrackId] = createSignal<string | null>(null)

  const columnCount = () => jam.metadata.columnCount
  const tracks = () => jam.project.tracks
  const currentColumnIndex = () => jam.currentColumnIndex()
  const selectedColumnIndex = () => jam.selectedColumnIndex()

  // Create array of column indices for iteration
  // const columnIndices = createMemo(() => Array.from({ length: columnCount() }, (_, i) => i))

  function handleCellToggle(trackId: string, columnIndex: number) {
    const hadClip = jam.hasClipAtColumn(trackId, columnIndex)
    jam.toggleClipAtColumn(columnIndex, trackId)

    // Start painting mode
    const mode = hadClip ? 'remove' : 'add'
    setIsPainting(true)
    setPaintMode(mode)
    setPaintAnchorColumn(columnIndex)
    setPaintTrackId(trackId)

    // Start paint session for overlap handling (only for add mode)
    if (mode === 'add') {
      const clipInfo = jam.getClipAtColumn(trackId, columnIndex)
      if (clipInfo) {
        jam.startPaintSession(trackId, clipInfo.clipId)
      }
    }
  }

  function handleCellPointerEnter(event: PointerEvent, trackId: string, columnIndex: number) {
    if (!isPainting() || !(event.buttons & 1)) return

    const mode = paintMode()
    const anchorColumn = paintAnchorColumn()
    const paintTrack = paintTrackId()

    // Only allow painting on the same track
    if (trackId !== paintTrack || anchorColumn === null) return

    if (mode === 'add') {
      // Set clip to span from anchor to current column (bidirectional)
      jam.setClipSpan(trackId, anchorColumn, columnIndex)
    } else if (mode === 'remove') {
      const hasClip = jam.hasClipAtColumn(trackId, columnIndex)
      if (hasClip) {
        jam.removeClipAtColumn(trackId, columnIndex)
      }
    }
  }

  function handlePointerUp() {
    // End paint session (commits overlap changes)
    jam.endPaintSession()

    setIsPainting(false)
    setPaintMode(null)
    setPaintAnchorColumn(null)
    setPaintTrackId(null)
  }

  function handleAddTrack() {
    const trackCount = tracks().length
    const videoUrl = TEST_VIDEOS[trackCount % TEST_VIDEOS.length]
    const trackId = jam.addTrack()
    jam.setTrackVideoUrl(trackId, videoUrl)
  }

  const gridTemplateColumns = () => `80px repeat(${columnCount()}, 60px) 48px`

  return (
    <div
      class={styles.sequencer}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Tracks container (scrollable) */}
      <div class={styles.tracksContainer}>
        <div
          class={styles.tracksGrid}
          style={{
            'grid-template-columns': gridTemplateColumns(),
            'grid-template-rows': `repeat(${tracks().length}, 48px) 1fr`,
          }}
        >
          <For each={tracks()}>
            {track => (
              <>
                <TrackLabel name={track.name ?? track.id} trackId={track.id} />
                <Repeat times={columnCount()}>
                  {colIndex => (
                    <div
                      class={clsx(
                        styles.cellWrapper,
                        currentColumnIndex() === colIndex && styles.current,
                      )}
                    >
                      <Cell
                        trackId={track.id}
                        columnIndex={colIndex}
                        clipPosition={jam.getClipPosition(track.id, colIndex)}
                        onToggle={() => handleCellToggle(track.id, colIndex)}
                        onPointerEnter={event => handleCellPointerEnter(event, track.id, colIndex)}
                      />
                    </div>
                  )}
                </Repeat>
                <div />
              </>
            )}
          </For>
          {/* Add track button row */}
          <div class={clsx(styles.lastRow, styles.addTrackButtonContainer)}>
            <button class={styles.addTrackButton} onClick={handleAddTrack}>
              + Track
            </button>
          </div>
          <Repeat times={columnCount()}>
            {colIndex => {
              const region = () => jam.getLayoutRegionForColumn(colIndex)
              return (
                <button
                  class={clsx(
                    styles.timelineCell,
                    currentColumnIndex() === colIndex && styles.current,
                  )}
                  data-region={jam.getRegionPosition(colIndex)}
                  onClick={() => {
                    jam.selectColumn(colIndex)
                    jam.seekToColumn(colIndex)
                  }}
                >
                  <div
                    class={clsx(
                      styles.timelineButton,
                      selectedColumnIndex() === colIndex && styles.selected,
                    )}
                  >
                    <span class={styles.timelineDuration}>{jam.metadata.columnDuration}</span>
                    <span class={styles.timelineIcon}>
                      {region() ? LAYOUT_ICONS[region()!.layout] : '·'}
                    </span>
                  </div>
                </button>
              )
            }}
          </Repeat>
          <div class={styles.addColumnButtonContainer}>
            <button class={styles.addColumnButton} onClick={() => jam.addColumn()}>
              +
            </button>
          </div>
          <div />
        </div>
      </div>
    </div>
  )
}
