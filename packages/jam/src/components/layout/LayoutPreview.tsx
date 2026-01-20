/**
 * Layout Preview
 *
 * Visual preview of a layout type showing slot arrangement.
 */

import type { JamLayoutType } from '@eddy/lexicons'
import clsx from 'clsx'
import { Index } from 'solid-js'
import { getSlotCount } from '~/primitives/compile-jam-timeline'
import styles from './LayoutPreview.module.css'

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

export interface LayoutPreviewProps {
  layout: JamLayoutType
  slots?: string[]
  size?: number
  showSlotNumbers?: boolean
}

/**********************************************************************************/
/*                                                                                */
/*                                Layout Preview                                  */
/*                                                                                */
/**********************************************************************************/

export function LayoutPreview(props: LayoutPreviewProps) {
  const size = () => props.size ?? 64
  const slots = () => props.slots ?? []
  const slotCount = () => getSlotCount(props.layout)

  return (
    <div
      class={styles.container}
      data-layout={props.layout}
      style={{ width: `${size()}px`, height: `${size()}px` }}
    >
      <Index each={Array(slotCount())}>
        {(_, index) => (
          <div class={clsx(styles.slot, slots()[index] && styles.hasTrack)}>
            {props.showSlotNumbers ? index + 1 : ''}
          </div>
        )}
      </Index>
    </div>
  )
}
