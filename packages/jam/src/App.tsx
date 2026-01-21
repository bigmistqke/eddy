/**
 * Jam App
 *
 * Grid-based video sequencer where clips flow through changing layouts.
 */

import clsx from 'clsx'
import styles from './App.module.css'
import { Grid } from './components/sequencer'
import { ActionBar } from './components/layout'
import { Preview } from './components/preview'
import { createJam } from './primitives/create-jam'

/**********************************************************************************/
/*                                                                                */
/*                                      App                                       */
/*                                                                                */
/**********************************************************************************/

export function App() {
  const jam = createJam({
    canvasSize: { width: 640, height: 360 },
  })

  function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    const ms = Math.floor((seconds % 1) * 100)
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
  }

  return (
    <div class={styles.app}>
      {/* Preview area */}
      <div class={styles.preview}>
        <Preview jam={jam} />
        <div class={styles.previewOverlay}>
          Column {jam.currentColumnIndex() + 1} / {jam.metadata.columns.length}
        </div>
      </div>

      {/* Sequencer grid */}
      <div class={styles.sequencer}>
        <Grid jam={jam} />
      </div>

      {/* Action bar for column editing */}
      <ActionBar jam={jam} />

      {/* Transport controls */}
      <div class={styles.transport}>
        <button
          class={clsx(styles.transportButton, jam.isPlaying() && styles.active)}
          onClick={() => jam.togglePlay()}
        >
          {jam.isPlaying() ? 'Pause' : 'Play'}
        </button>
        <button class={styles.transportButton} onClick={() => jam.stop()}>
          Stop
        </button>
        <button
          class={clsx(styles.transportButton, jam.loop() && styles.active)}
          onClick={() => jam.setLoop(!jam.loop())}
        >
          Loop
        </button>
        <div class={styles.time}>{formatTime(jam.currentTime())}</div>
        <div style={{ flex: 1 }} />
        <input
          type="number"
          class={styles.bpmInput}
          value={jam.metadata.bpm}
          onInput={event => jam.setBpm(parseInt(event.currentTarget.value) || 120)}
          min={20}
          max={300}
        />
        <span class={styles.bpmLabel}>BPM</span>
      </div>
    </div>
  )
}
