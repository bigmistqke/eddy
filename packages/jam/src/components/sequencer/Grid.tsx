/**
 * Grid
 *
 * Main sequencer grid component.
 * Rows = tracks, columns = time segments.
 * Shows clips with connected styling for multi-column spans.
 */

import type { JamColumnDuration, JamLayoutType } from '@eddy/lexicons'
import clsx from 'clsx'
import { createSignal, For, Show } from 'solid-js'
import type { ClipPosition, Jam } from '~/primitives/create-jam'
import styles from './Grid.module.css'

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

/**********************************************************************************/
/*                                                                                */
/*                                 Column Header                                  */
/*                                                                                */
/**********************************************************************************/

interface ColumnHeaderProps {
  index: number
  duration: JamColumnDuration
  layout: JamLayoutType
  isSelected: boolean
  isCurrent: boolean
  onSelect: () => void
}

function ColumnHeader(props: ColumnHeaderProps) {
  return (
    <div
      class={clsx(
        styles.header,
        props.isSelected && styles.selected,
        props.isCurrent && styles.current
      )}
      onClick={props.onSelect}
    >
      <span>{props.duration}</span>
      <span class={styles.headerIcon}>{LAYOUT_ICONS[props.layout]}</span>
    </div>
  )
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
  slotIndex: number | null
  isCurrent: boolean
  onToggle: () => void
  onPointerEnter: (event: PointerEvent) => void
}

function Cell(props: CellProps) {
  const isVisible = () => props.slotIndex !== null
  const hasClip = () => props.clipPosition !== 'none'

  return (
    <div
      class={clsx(styles.cell, props.isCurrent && styles.current)}
      data-clip={props.clipPosition}
      data-visible={hasClip() && isVisible()}
      onPointerDown={event => {
        event.preventDefault()
        props.onToggle()
      }}
      onPointerEnter={event => props.onPointerEnter(event)}
    >
      <Show when={props.slotIndex !== null && props.slotIndex + 1}>
        {slotNumber => <span class={styles.slotIndicator}>{slotNumber()}</span>}
      </Show>
    </div>
  )
}

/**********************************************************************************/
/*                                                                                */
/*                                 Timeline Ruler                                 */
/*                                                                                */
/**********************************************************************************/

interface TimelineRulerProps {
  jam: Jam
}

function TimelineRuler(props: TimelineRulerProps) {
  const { jam } = props

  return (
    <div class={styles.timelineRuler}>
      <For each={jam.metadata.columns}>
        {(_, index) => (
          <div
            class={styles.rulerSegment}
            classList={{ [styles.current]: jam.currentColumnIndex() === index() }}
            onClick={() => jam.seekToColumn(index())}
          />
        )}
      </For>
    </div>
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
  const [paintStartColumn, setPaintStartColumn] = createSignal<number | null>(null)
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
    setPaintStartColumn(columnIndex)
    setPaintTrackId(trackId)
  }

  function handleCellPointerEnter(event: PointerEvent, trackId: string, columnIndex: number) {
    if (!isPainting() || !(event.buttons & 1)) return

    const mode = paintMode()
    const startColumn = paintStartColumn()
    const startTrackId = paintTrackId()

    // Only allow painting on the same track
    if (trackId !== startTrackId) return

    const hasClip = jam.hasClipAtColumn(trackId, columnIndex)

    if (mode === 'add' && !hasClip && startColumn !== null) {
      // Extend the clip from the start column to include this column
      jam.extendClipToColumn(trackId, startColumn, columnIndex)
    } else if (mode === 'remove' && hasClip) {
      jam.removeClipAtColumn(trackId, columnIndex)
    }
  }

  function handlePointerUp() {
    setIsPainting(false)
    setPaintMode(null)
    setPaintStartColumn(null)
    setPaintTrackId(null)
  }

  return (
    <div
      class={styles.grid}
      style={{ 'grid-template-columns': `80px repeat(${columns().length}, minmax(48px, 1fr))` }}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      {/* Header row */}
      <div />
      <For each={columns()}>
        {(column, index) => (
          <ColumnHeader
            index={index()}
            duration={column.duration}
            layout={column.layout}
            isSelected={selectedColumnIndex() === index()}
            isCurrent={currentColumnIndex() === index()}
            onSelect={() => jam.selectColumn(index())}
          />
        )}
      </For>

      {/* Track rows */}
      <For each={tracks()}>
        {track => (
          <>
            <TrackLabel name={track.name ?? track.id} trackId={track.id} />
            <For each={columns()}>
              {(_, columnIndex) => (
                <Cell
                  trackId={track.id}
                  columnIndex={columnIndex()}
                  clipPosition={jam.getClipPosition(track.id, columnIndex())}
                  slotIndex={jam.getTrackSlotIndex(columnIndex(), track.id)}
                  isCurrent={currentColumnIndex() === columnIndex()}
                  onToggle={() => handleCellToggle(track.id, columnIndex())}
                  onPointerEnter={event => handleCellPointerEnter(event, track.id, columnIndex())}
                />
              )}
            </For>
          </>
        )}
      </For>

      {/* Timeline ruler row */}
      <div class={styles.rulerLabel}>Time</div>
      <TimelineRuler jam={jam} />
    </div>
  )
}
