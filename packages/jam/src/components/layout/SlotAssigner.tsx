/**
 * Slot Assigner
 *
 * Assign tracks to layout slots for a column.
 * Shows the layout with slots, tap slot to cycle through available tracks.
 */

import type { JamColumn, JamLayoutType, Track } from '@eddy/lexicons'
import clsx from 'clsx'
import { For, Index } from 'solid-js'
import { getSlotCount } from '~/primitives/compile-jam-timeline'
import styles from './SlotAssigner.module.css'

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

export interface SlotAssignerProps {
  column: JamColumn
  tracks: Track[]
  onAssignSlot: (slotIndex: number, trackId: string | null) => void
}

/**********************************************************************************/
/*                                                                                */
/*                                Slot Assigner                                   */
/*                                                                                */
/**********************************************************************************/

export function SlotAssigner(props: SlotAssignerProps) {
  const slotCount = () => getSlotCount(props.column.layout)
  const slots = () => props.column.slots ?? []

  function handleSlotClick(slotIndex: number) {
    const currentTrackId = slots()[slotIndex] || null
    const availableTracks = props.tracks.filter(
      track => !slots().includes(track.id) || slots()[slotIndex] === track.id
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
    <div class={styles.container} data-layout={props.column.layout}>
      <Index each={Array(slotCount())}>
        {(_, index) => {
          const trackId = () => slots()[index] || null
          const track = () => (trackId() ? props.tracks.find(t => t.id === trackId()) : null)

          return (
            <div
              class={clsx(styles.slot, track() && styles.hasTrack)}
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
