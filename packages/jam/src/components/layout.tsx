/**
 * Layout Editor
 *
 * Edit layout and slot assignments for a selected column.
 */

import type { JamColumn, JamColumnDuration, JamLayoutType, Track } from '@eddy/lexicons'
import clsx from 'clsx'
import { createMemo, For, Index, Show } from 'solid-js'
import { getSlotCount } from '~/primitives/compile-jam-timeline'
import type { Jam } from '~/primitives/create-jam'
import styles from './Layout.module.css'

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

export interface LayoutEditorProps {
  jam: Jam
}

/**********************************************************************************/
/*                                                                                */
/*                                   Constants                                    */
/*                                                                                */
/**********************************************************************************/

const DURATIONS: JamColumnDuration[] = ['1', '1/2', '1/4', '1/8', '1/16']
const LAYOUT_TYPES: JamLayoutType[] = ['full', 'pip', 'h-split', 'v-split', '2x2', '3-up']

/**********************************************************************************/
/*                                                                                */
/*                                Layout Preview                                  */
/*                                                                                */
/**********************************************************************************/

interface LayoutPreviewProps {
  layout: JamLayoutType
  slots?: string[]
  size?: number
  showSlotNumbers?: boolean
}

function LayoutPreview(props: LayoutPreviewProps) {
  const size = () => props.size ?? 64
  const slots = () => props.slots ?? []
  const slotCount = () => getSlotCount(props.layout)

  return (
    <div
      class={styles.preview}
      data-layout={props.layout}
      style={{ width: `${size()}px`, height: `${size()}px` }}
    >
      <Index each={Array(slotCount())}>
        {(_, index) => (
          <div class={clsx(styles.previewSlot, slots()[index] && styles.hasTrack)}>
            {props.showSlotNumbers ? index + 1 : ''}
          </div>
        )}
      </Index>
    </div>
  )
}

/**********************************************************************************/
/*                                                                                */
/*                               Layout Selector                                  */
/*                                                                                */
/**********************************************************************************/

interface LayoutSelectorProps {
  value: JamLayoutType
  onChange: (layout: JamLayoutType) => void
}

function LayoutSelector(props: LayoutSelectorProps) {
  return (
    <div class={styles.selector}>
      <For each={LAYOUT_TYPES}>
        {layout => (
          <button
            class={clsx(styles.selectorButton, props.value === layout && styles.selected)}
            onClick={() => props.onChange(layout)}
          >
            <LayoutPreview layout={layout} size={48} showSlotNumbers />
          </button>
        )}
      </For>
    </div>
  )
}

/**********************************************************************************/
/*                                                                                */
/*                                Slot Assigner                                   */
/*                                                                                */
/**********************************************************************************/

interface SlotAssignerProps {
  column: JamColumn
  tracks: Track[]
  onAssignSlot: (slotIndex: number, trackId: string | null) => void
}

function SlotAssigner(props: SlotAssignerProps) {
  const slotCount = () => getSlotCount(props.column.layout)
  const slots = () => props.column.slots ?? []

  function handleSlotClick(slotIndex: number) {
    const currentTrackId = slots()[slotIndex] || null
    const availableTracks = props.tracks.filter(
      track => !slots().includes(track.id) || slots()[slotIndex] === track.id,
    )

    if (availableTracks.length === 0) {
      props.onAssignSlot(slotIndex, null)
      return
    }

    if (currentTrackId === null) {
      props.onAssignSlot(slotIndex, availableTracks[0].id)
    } else {
      const currentIndex = availableTracks.findIndex(t => t.id === currentTrackId)
      const nextIndex = currentIndex + 1
      if (nextIndex >= availableTracks.length) {
        props.onAssignSlot(slotIndex, null)
      } else {
        props.onAssignSlot(slotIndex, availableTracks[nextIndex].id)
      }
    }
  }

  return (
    <div class={styles.assigner} data-layout={props.column.layout}>
      <Index each={Array(slotCount())}>
        {(_, index) => {
          const trackId = () => slots()[index] || null
          const track = () => (trackId() ? props.tracks.find(t => t.id === trackId()) : null)

          return (
            <div
              class={clsx(styles.assignerSlot, track() && styles.hasTrack)}
              onClick={() => handleSlotClick(index)}
            >
              {track()?.name ?? `Slot ${index + 1}`}
            </div>
          )
        }}
      </Index>
    </div>
  )
}

/**********************************************************************************/
/*                                                                                */
/*                                Layout Editor                                   */
/*                                                                                */
/**********************************************************************************/

export function LayoutEditor(props: LayoutEditorProps) {
  const { jam } = props

  const selectedColumn = createMemo(() => jam.selectedColumn())
  const selectedIndex = createMemo(() => jam.selectedColumnIndex())

  function handleLayoutChange(layout: JamLayoutType) {
    const index = selectedIndex()
    if (index !== null) {
      jam.setColumnLayout(index, layout)
    }
  }

  function handleDurationChange(duration: JamColumnDuration) {
    const index = selectedIndex()
    if (index !== null) {
      jam.setColumnDuration(index, duration)
    }
  }

  function handleSlotAssign(slotIndex: number, trackId: string | null) {
    const index = selectedIndex()
    if (index !== null) {
      jam.assignSlot(index, slotIndex, trackId)
    }
  }

  return (
    <div class={styles.container}>
      <Show
        when={selectedColumn()}
        fallback={<div class={styles.placeholder}>Select a column to edit</div>}
      >
        {column => (
          <>
            {/* Duration selector */}
            <div class={styles.section}>
              <span class={styles.label}>Duration</span>
              <div class={styles.buttonRow}>
                <For each={DURATIONS}>
                  {duration => (
                    <button
                      class={clsx(
                        styles.durationButton,
                        column().duration === duration && styles.selected,
                      )}
                      onClick={() => handleDurationChange(duration)}
                    >
                      {duration}
                    </button>
                  )}
                </For>
              </div>
            </div>

            {/* Layout selector */}
            <div class={styles.section}>
              <span class={styles.label}>Layout</span>
              <LayoutSelector value={column().layout} onChange={handleLayoutChange} />
            </div>

            {/* Slot assigner */}
            <div class={styles.section}>
              <span class={styles.label}>Slots</span>
              <SlotAssigner
                column={column()}
                tracks={jam.project.tracks}
                onAssignSlot={handleSlotAssign}
              />
            </div>

            {/* Column actions */}
            <div class={styles.buttonRow}>
              <button
                class={styles.actionButton}
                onClick={() => {
                  const index = selectedIndex()
                  if (index !== null) {
                    jam.duplicateColumn(index)
                  }
                }}
              >
                Duplicate
              </button>
              <button
                class={styles.deleteButton}
                onClick={() => {
                  const index = selectedIndex()
                  if (index !== null) {
                    jam.removeColumn(index)
                  }
                }}
              >
                Delete
              </button>
            </div>
          </>
        )}
      </Show>
    </div>
  )
}
