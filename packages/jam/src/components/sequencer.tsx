/**
 * Grid
 *
 * Main sequencer grid component.
 * Rows = tracks, columns = time segments.
 * Shows clips with connected styling for multi-column spans.
 */

import type { ClipLayout, JamLayoutType } from '@eddy/lexicons'
import { Repeat } from '@solid-primitives/range'
import clsx from 'clsx'
import { createEffect, createSignal, For, Show } from 'solid-js'
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

/** Convert layout source to JamLayoutType for icon display */
function layoutSourceToType(source: ClipLayout): JamLayoutType {
  const { mode, columns, rows } = source
  if (mode === 'pip') return 'pip'
  if (mode === 'focus') return 'full'
  if (mode === 'split') return 'h-split'
  // Grid mode - determine by dimensions
  if (columns === 1 && rows === 1) return 'full'
  if (columns === 2 && rows === 1) return 'h-split'
  if (columns === 1 && rows === 2) return 'v-split'
  if (columns === 2 && rows === 2) return '2x2'
  return 'full'
}

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
  const [isPainting, setIsPainting] = createSignal(false)
  const [paintMode, setPaintMode] = createSignal<'add' | 'remove' | null>(null)
  const [paintAnchorColumn, setPaintAnchorColumn] = createSignal<number | null>(null)
  const [paintTrackId, setPaintTrackId] = createSignal<string | null>(null)

  const columnCount = () => props.jam.metadata.columnCount
  const tracks = () => props.jam.contentTracks()
  const currentColumnIndex = () => props.jam.currentColumnIndex()
  const selectedColumnIndex = () => props.jam.selectedColumnIndex()

  function handleCellToggle(trackId: string, columnIndex: number) {
    const hadClip = props.jam.hasClipAtColumn(trackId, columnIndex)
    props.jam.toggleClipAtColumn(columnIndex, trackId)

    // Start painting mode
    const mode = hadClip ? 'remove' : 'add'
    setIsPainting(true)
    setPaintMode(mode)
    setPaintAnchorColumn(columnIndex)
    setPaintTrackId(trackId)

    // Start paint session for overlap handling (only for add mode)
    if (mode === 'add') {
      const clipInfo = props.jam.getClipAtColumn(trackId, columnIndex)
      if (clipInfo) {
        props.jam.startPaintSession(trackId, clipInfo.clipId)
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
      props.jam.setClipSpan(trackId, anchorColumn, columnIndex)
    } else if (mode === 'remove') {
      const hasClip = props.jam.hasClipAtColumn(trackId, columnIndex)
      if (hasClip) {
        props.jam.removeClipAtColumn(trackId, columnIndex)
      }
    }
  }

  function handlePointerUp() {
    // End paint session (commits overlap changes)
    props.jam.endPaintSession()

    setIsPainting(false)
    setPaintMode(null)
    setPaintAnchorColumn(null)
    setPaintTrackId(null)
  }

  function handleAddTrack() {
    const trackCount = tracks().length
    const videoUrl = TEST_VIDEOS[trackCount % TEST_VIDEOS.length]
    props.jam.addTrack(undefined, videoUrl)
  }

  const gridTemplateColumns = () => `80px repeat(${columnCount()}, 60px) 48px`

  createEffect(() => console.log('props', props.jam.currentTime()))

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
                        clipPosition={props.jam.getClipPosition(track.id, colIndex)}
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
              const region = () => props.jam.getLayoutRegionForColumn(colIndex)
              const regionPosition = () => props.jam.getRegionPosition(colIndex)
              const isRegionSelected = () => {
                const selectedIdx = selectedColumnIndex()
                if (selectedIdx === null) return false
                const selectedRegion = props.jam.getLayoutRegionForColumn(selectedIdx)
                const currentRegion = region()
                return selectedRegion?.clipId === currentRegion?.clipId
              }
              const showContent = () => {
                const pos = regionPosition()
                return pos === 'single' || pos === 'start' || pos === 'none'
              }
              return (
                <button
                  class={clsx(
                    styles.timelineCell,
                    currentColumnIndex() === colIndex && styles.current,
                  )}
                  data-region={regionPosition()}
                  onClick={() => {
                    props.jam.selectColumn(colIndex)
                    props.jam.seekToColumn(colIndex)
                  }}
                >
                  <div class={clsx(styles.timelineButton, isRegionSelected() && styles.selected)}>
                    <Show when={showContent()}>
                      <span class={styles.timelineDuration}>
                        {props.jam.metadata.columnDuration}
                      </span>
                      <span class={styles.timelineIcon}>
                        {region() ? LAYOUT_ICONS[layoutSourceToType(region()!.clip)] : '·'}
                      </span>
                    </Show>
                  </div>
                </button>
              )
            }}
          </Repeat>
          <div class={styles.addColumnButtonContainer}>
            <button class={styles.addColumnButton} onClick={() => props.jam.addColumn()}>
              +
            </button>
          </div>
          <div />
        </div>
      </div>
    </div>
  )
}
