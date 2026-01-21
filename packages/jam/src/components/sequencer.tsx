/**
 * Grid
 *
 * Main sequencer grid component.
 * Rows = tracks, columns = time segments.
 * Shows clips with connected styling for multi-column spans.
 */

import type { JamColumnDuration, JamLayoutType } from '@eddy/lexicons'
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
  return <div class={styles.label}>{props.name}</div>
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

  const columns = () => jam.metadata.columns
  const tracks = () => jam.project.tracks
  const currentColumnIndex = () => jam.currentColumnIndex()
  const selectedColumnIndex = () => jam.selectedColumnIndex()

  function handleCellToggle(trackId: string, columnIndex: number) {
    const hadClip = jam.hasClipAtColumn(trackId, columnIndex)
    jam.toggleClipAtColumn(columnIndex, trackId)

    // Start painting mode
    setIsPainting(true)
    setPaintMode(hadClip ? 'remove' : 'add')
    setPaintAnchorColumn(columnIndex)
    setPaintTrackId(trackId)
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

  const gridTemplateColumns = () => `80px repeat(${columns().length}, 60px) 48px`

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
            'grid-template-rows': `8px repeat(${tracks().length}, 48px) auto 1fr`,
          }}
        >
          {/* Spacer row */}
          <div />
          <For each={columns()}>
            {(column, columnIndex) => (
              <div
                class={clsx(
                  styles.spacer,
                  currentColumnIndex() === columnIndex() && styles.current,
                )}
              />
            )}
          </For>
          <div />

          <For each={tracks()}>
            {track => (
              <>
                <TrackLabel name={track.name ?? track.id} trackId={track.id} />
                <For each={columns()}>
                  {(column, columnIndex) => (
                    <div
                      class={clsx(
                        styles.cellWrapper,
                        currentColumnIndex() === columnIndex() && styles.current,
                      )}
                    >
                      <Cell
                        trackId={track.id}
                        columnIndex={columnIndex()}
                        clipPosition={jam.getClipPosition(track.id, columnIndex())}
                        onToggle={() => handleCellToggle(track.id, columnIndex())}
                        onPointerEnter={event =>
                          handleCellPointerEnter(event, track.id, columnIndex())
                        }
                      />
                    </div>
                  )}
                </For>
                <div />
              </>
            )}
          </For>
          {/* Add track button row */}
          <button class={styles.addTrackButton} onClick={handleAddTrack}>
            + Track
          </button>
          <For each={columns()}>
            {(column, columnIndex) => (
              <div
                class={clsx(
                  styles.filler,
                  currentColumnIndex() === columnIndex() && styles.current,
                )}
              />
            )}
          </For>
          <div />
        </div>
      </div>

      {/* Timeline row */}
      <div class={styles.timelineRow} style={{ 'grid-template-columns': gridTemplateColumns() }}>
        <div />
        <For each={columns()}>
          {(column, columnIndex) => (
            <div
              class={clsx(
                styles.timelineCell,
                currentColumnIndex() === columnIndex() && styles.current,
              )}
            >
              <button
                class={clsx(
                  styles.timelineButton,
                  selectedColumnIndex() === columnIndex() && styles.selected,
                )}
                onClick={() => {
                  jam.selectColumn(columnIndex())
                  jam.seekToColumn(columnIndex())
                }}
              >
                <span class={styles.timelineDuration}>{column.duration}</span>
                <span class={styles.timelineIcon}>{LAYOUT_ICONS[column.layout]}</span>
              </button>
            </div>
          )}
        </For>
        <button class={styles.addColumnButton} onClick={() => jam.addColumn()}>
          +
        </button>
      </div>
    </div>
  )
}
