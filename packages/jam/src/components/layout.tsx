/**
 * Action Bar
 *
 * Compact horizontal bar for editing selected column/region properties.
 */

import type { ClipSourceLayout, JamLayoutType } from '@eddy/lexicons'
import clsx from 'clsx'
import { createMemo, For, Index, Show } from 'solid-js'
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

/** Get number of slots for a layout type */
function getSlotCount(layoutType: JamLayoutType): number {
  switch (layoutType) {
    case 'full':
      return 1
    case 'pip':
    case 'h-split':
    case 'v-split':
      return 2
    case '3-up':
      return 3
    case '2x2':
      return 4
    default:
      return 1
  }
}

/** Convert layout source to JamLayoutType */
function layoutSourceToType(source: ClipSourceLayout): JamLayoutType {
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
      <Index each={Array(slotCount())}>{() => <div class={styles.previewSlot} />}</Index>
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
  const selectedRegion = createMemo(() => props.jam.selectedLayoutRegion())
  const selectedIndex = createMemo(() => props.jam.selectedColumnIndex())

  function handleLayoutChange(layout: JamLayoutType) {
    const index = selectedIndex()
    if (index !== null) {
      props.jam.setRegionLayout(index, layout)
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
                    class={clsx(styles.layoutButton, layoutSourceToType(region().source) === layout && styles.selected)}
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
            <button class={styles.actionButton} onClick={() => props.jam.addColumn()}>
              + Column
            </button>
            <button class={styles.deleteButton} onClick={() => props.jam.removeColumn()}>
              - Column
            </button>
          </>
        )}
      </Show>
    </div>
  )
}
