/**
 * Track Label
 *
 * Label for a track row showing track name.
 */

import styles from './TrackLabel.module.css'

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

export interface TrackLabelProps {
  name: string
  trackId: string
}

/**********************************************************************************/
/*                                                                                */
/*                                 Track Label                                    */
/*                                                                                */
/**********************************************************************************/

export function TrackLabel(props: TrackLabelProps) {
  return <div class={styles.label}>{props.name}</div>
}
