/**
 * Layout Selector
 *
 * Grid of layout type options to choose from.
 */

import type { JamLayoutType } from '@eddy/lexicons'
import clsx from 'clsx'
import { For } from 'solid-js'
import { LayoutPreview } from './LayoutPreview'
import styles from './LayoutSelector.module.css'

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

export interface LayoutSelectorProps {
  value: JamLayoutType
  onChange: (layout: JamLayoutType) => void
}

/**********************************************************************************/
/*                                                                                */
/*                                   Constants                                    */
/*                                                                                */
/**********************************************************************************/

const LAYOUT_TYPES: JamLayoutType[] = ['full', 'pip', 'h-split', 'v-split', '2x2', '3-up']

/**********************************************************************************/
/*                                                                                */
/*                               Layout Selector                                  */
/*                                                                                */
/**********************************************************************************/

export function LayoutSelector(props: LayoutSelectorProps) {
  return (
    <div class={styles.container}>
      <For each={LAYOUT_TYPES}>
        {layout => (
          <button
            class={clsx(styles.button, props.value === layout && styles.selected)}
            onClick={() => props.onChange(layout)}
          >
            <LayoutPreview layout={layout} size={48} showSlotNumbers />
          </button>
        )}
      </For>
    </div>
  )
}
