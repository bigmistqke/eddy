/**
 * Action Bar
 *
 * Compact horizontal bar for editing selected column properties.
 */

import type { JamLayoutType } from '@eddy/lexicons'
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

export interface ActionBarProps {
  jam: Jam
}

/**********************************************************************************/
/*                                                                                */
/*                                Layout Preview                                  */
/*                                                                                */
/**********************************************************************************/

interface LayoutPreviewProps {
  layout: JamLayoutType
  size?: number
}

function LayoutPreview(props: LayoutPreviewProps) {
  const size = () => props.size ?? 24
  const slotCount = () => getSlotCount(props.layout)

  return (
    <div
      class={styles.preview}
      data-layout={props.layout}
      style={{ width: `${size()}px`, height: `${size()}px` }}
    >
      <Index each={Array(slotCount())}>
        {() => <div class={styles.previewSlot} />}
      </Index>
    </div>
  )
}

/**********************************************************************************/
/*                                                                                */
/*                                  Action Bar                                    */
/*                                                                                */
/**********************************************************************************/

export function ActionBar(props: ActionBarProps) {
  const { jam } = props

  const selectedColumn = createMemo(() => jam.selectedColumn())
  const selectedIndex = createMemo(() => jam.selectedColumnIndex())
  const availableLayouts = createMemo(() => {
    const index = selectedIndex()
    return index !== null ? jam.getValidLayoutsForColumn(index) : []
  })

  function handleLayoutChange(layout: JamLayoutType) {
    const index = selectedIndex()
    if (index !== null) {
      jam.setColumnLayout(index, layout)
    }
  }

  function parseDuration(value: string): { numerator: number; denominator: number } {
    if (value.includes('/')) {
      const [num, denom] = value.split('/')
      return { numerator: parseInt(num) || 1, denominator: parseInt(denom) || 1 }
    }
    return { numerator: parseInt(value) || 1, denominator: 1 }
  }

  function formatDuration(numerator: number, denominator: number): string {
    return denominator === 1 ? `${numerator}` : `${numerator}/${denominator}`
  }

  return (
    <div class={styles.actionBar}>
      <Show
        when={selectedColumn()}
        fallback={<span class={styles.hint}>Select a column</span>}
      >
        {column => {
          const duration = () => parseDuration(column().duration)

          return (
            <>
              {/* Duration inputs */}
              <div class={styles.durationGroup}>
                <input
                  type="number"
                  class={styles.durationInput}
                  value={duration().numerator}
                  min={1}
                  onInput={event => {
                    const num = parseInt(event.currentTarget.value) || 1
                    const index = selectedIndex()
                    if (index !== null) {
                      jam.setColumnDuration(index, formatDuration(num, duration().denominator))
                    }
                  }}
                />
                <span class={styles.durationSeparator}>/</span>
                <input
                  type="number"
                  class={styles.durationInput}
                  value={duration().denominator}
                  min={1}
                  onInput={event => {
                    const denom = parseInt(event.currentTarget.value) || 1
                    const index = selectedIndex()
                    if (index !== null) {
                      jam.setColumnDuration(index, formatDuration(duration().numerator, denom))
                    }
                  }}
                />
              </div>

              {/* Layout selector */}
              <div class={styles.layoutGroup}>
                <For each={availableLayouts()}>
                  {layout => (
                    <button
                      class={clsx(styles.layoutButton, column().layout === layout && styles.selected)}
                      onClick={() => handleLayoutChange(layout)}
                    >
                      <LayoutPreview layout={layout} size={24} />
                    </button>
                  )}
                </For>
              </div>

              {/* Spacer */}
              <div style={{ flex: 1 }} />

              {/* Column actions */}
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
            </>
          )
        }}
      </Show>
    </div>
  )
}
