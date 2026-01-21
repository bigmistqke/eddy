/**
 * Action Bar
 *
 * Compact horizontal bar for editing selected column/region properties.
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

const ALL_LAYOUTS: JamLayoutType[] = ['full', 'pip', '2x2', '3-up', 'h-split', 'v-split']

export function ActionBar(props: ActionBarProps) {
  const { jam } = props

  const selectedRegion = createMemo(() => jam.selectedLayoutRegion())
  const selectedIndex = createMemo(() => jam.selectedColumnIndex())

  function handleLayoutChange(layout: JamLayoutType) {
    const index = selectedIndex()
    if (index !== null) {
      jam.setRegionLayout(index, layout)
    }
  }

  return (
    <div class={styles.actionBar}>
      <Show
        when={selectedRegion()}
        fallback={<span class={styles.hint}>Select a column to edit its layout region</span>}
      >
        {region => (
          <>
            {/* Region info */}
            <span class={styles.regionInfo}>
              Region: {region().startColumn + 1}–{region().endColumn}
            </span>

            {/* Layout selector */}
            <div class={styles.layoutGroup}>
              <For each={ALL_LAYOUTS}>
                {layout => (
                  <button
                    class={clsx(styles.layoutButton, region().layout === layout && styles.selected)}
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
              onClick={() => jam.addColumn()}
            >
              + Column
            </button>
            <button
              class={styles.deleteButton}
              onClick={() => jam.removeColumn()}
            >
              - Column
            </button>
          </>
        )}
      </Show>
    </div>
  )
}
