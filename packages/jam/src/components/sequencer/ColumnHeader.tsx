/**
 * Column Header
 *
 * Header for a sequencer column showing duration and layout type.
 * Tap to select column for editing.
 */

import type { JamColumnDuration, JamLayoutType } from '@eddy/lexicons'
import clsx from 'clsx'
import styles from './ColumnHeader.module.css'

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

export interface ColumnHeaderProps {
  index: number
  duration: JamColumnDuration
  layout: JamLayoutType
  isSelected: boolean
  isCurrent: boolean
  onSelect: () => void
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
/*                                Column Header                                   */
/*                                                                                */
/**********************************************************************************/

export function ColumnHeader(props: ColumnHeaderProps) {
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
      <span class={styles.icon}>{LAYOUT_ICONS[props.layout]}</span>
    </div>
  )
}
