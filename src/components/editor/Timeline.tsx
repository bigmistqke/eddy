import { type Component } from 'solid-js'
import { Track } from './Track'
import styles from './Timeline.module.css'

interface TimelineProps {
  projectId?: string
}

export const Timeline: Component<TimelineProps> = () => {
  return (
    <div class={styles.container}>
      <Track />
    </div>
  )
}

