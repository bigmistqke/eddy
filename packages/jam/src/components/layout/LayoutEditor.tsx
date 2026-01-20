/**
 * Layout Editor
 *
 * Edit layout and slot assignments for a selected column.
 */

import type { JamColumnDuration, JamLayoutType } from '@eddy/lexicons'
import clsx from 'clsx'
import { createMemo, For, Show } from 'solid-js'
import type { Jam } from '~/primitives/create-jam'
import styles from './LayoutEditor.module.css'
import { LayoutSelector } from './LayoutSelector'
import { SlotAssigner } from './SlotAssigner'

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
                      class={clsx(styles.durationButton, column().duration === duration && styles.selected)}
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
                class={styles.addButton}
                onClick={() => jam.addColumn(selectedIndex() ?? undefined)}
              >
                + Add After
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
