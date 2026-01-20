/**
 * Jam App
 *
 * Grid-based video sequencer where clips flow through changing layouts.
 */

import { createSignal, onCleanup, Show } from 'solid-js'
import clsx from 'clsx'
import styles from './App.module.css'
import { Grid } from './components/sequencer'
import { LayoutEditor } from './components/layout'
import { createJam } from './primitives/create-jam'

/**********************************************************************************/
/*                                                                                */
/*                                      App                                       */
/*                                                                                */
/**********************************************************************************/

export function App() {
  const [orientation, setOrientation] = createSignal<'portrait' | 'landscape'>(
    window.innerHeight > window.innerWidth ? 'portrait' : 'landscape'
  )

  const handleResize = () => {
    setOrientation(window.innerHeight > window.innerWidth ? 'portrait' : 'landscape')
  }
  window.addEventListener('resize', handleResize)
  onCleanup(() => window.removeEventListener('resize', handleResize))

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
    <div class={styles.app} data-orientation={orientation()}>
      {/* Preview area */}
      <div class={styles.preview}>
        <div style={{ 'text-align': 'center', color: '#666' }}>
          <p>Preview</p>
          <p style={{ 'font-size': '12px', 'margin-top': '8px' }}>
            Column {jam.currentColumnIndex() + 1} / {jam.metadata.columns.length}
          </p>
        </div>
      </div>

      {/* Sidebar (layout editor) */}
      <Show when={orientation() === 'landscape'}>
        <div class={styles.sidebar}>
          <LayoutEditor jam={jam} />
        </div>
      </Show>

      {/* Sequencer grid */}
      <div class={styles.sequencer}>
        <Grid jam={jam} />
      </div>

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

      {/* Layout editor for portrait mode */}
      <Show when={orientation() === 'portrait' && jam.selectedColumnIndex() !== null}>
        <div class={styles.sidebar}>
          <LayoutEditor jam={jam} />
        </div>
      </Show>
    </div>
  )
}
