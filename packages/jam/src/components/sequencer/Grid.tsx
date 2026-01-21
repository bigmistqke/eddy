/**
 * Grid
 *
 * Main sequencer grid component.
 * Rows = tracks, columns = time segments.
 * Shows clips with connected styling for multi-column spans.
 */

import { createSignal, For } from 'solid-js'
import type { Jam } from '~/primitives/create-jam'
import { Cell } from './Cell'
import { ColumnHeader } from './ColumnHeader'
import styles from './Grid.module.css'
import { TrackLabel } from './TrackLabel'

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
