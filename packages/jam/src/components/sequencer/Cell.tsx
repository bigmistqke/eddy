/**
 * Cell
 *
 * Individual grid cell representing a clip segment on a track.
 * Shows clip boundaries (start/middle/end/single) with connected styling.
 */

import clsx from 'clsx'
import { Show } from 'solid-js'
import type { ClipPosition } from '~/primitives/create-jam'
import styles from './Cell.module.css'

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

export interface CellProps {
  trackId: string
  columnIndex: number
  clipPosition: ClipPosition
  slotIndex: number | null
  isCurrent: boolean
  onToggle: () => void
  onPointerEnter: (event: PointerEvent) => void
}

/**********************************************************************************/
/*                                                                                */
/*                                      Cell                                      */
/*                                                                                */
/**********************************************************************************/

export function Cell(props: CellProps) {
  return (
    <div
      class={clsx(styles.cell, props.isCurrent && styles.current)}
      data-clip={props.clipPosition}
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
