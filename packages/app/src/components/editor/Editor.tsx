import { isClipLayout } from '@eddy/lexicons'
import {
  FiCircle,
  FiDownload,
  FiPause,
  FiPlay,
  FiRepeat,
  FiSquare,
  FiUpload,
  FiVolume2,
} from 'solid-icons/fi'
import {
  createEffect,
  createMemo,
  createSignal,
  Index,
  onMount,
  Show,
  type Component,
} from 'solid-js'
import { useAuth } from '~/contexts/auth-context'
import { createEditor } from '~/primitives/create-editor'
import styles from './Editor.module.css'
import { Track } from './Track'

/** Format time in seconds to MM:SS.ms */
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  const ms = Math.floor((seconds % 1) * 100)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`
}

/** Parse MM:SS.ms format to seconds */
function parseTime(str: string): number | null {
  // Handle MM:SS.ms or MM:SS or SS.ms or SS
  const match = str.match(/^(?:(\d+):)?(\d+)(?:\.(\d+))?$/)
  if (!match) return null

  const mins = match[1] ? parseInt(match[1], 10) : 0
  const secs = parseInt(match[2], 10)
  const ms = match[3] ? parseInt(match[3].padEnd(2, '0').slice(0, 2), 10) : 0

  return mins * 60 + secs + ms / 100
}

interface EditorProps {
  handle?: string
  rkey?: string
}

export const Editor: Component<EditorProps> = props => {
  const { agent } = useAuth()

  const [canvas, setCanvas] = createSignal<HTMLCanvasElement>()

  const editor = createEditor({
    agent,
    canvas,
    get handle() {
      return props.handle
    },
    get rkey() {
      return props.rkey
    },
  })

  // Expose editor for debugging and perf testing
  // Use createEffect to wait for player initialization (which creates __EDDY_DEBUG__)
  createEffect(() => {
    const _player = editor.player()
    if (_player) {
      const debug = (window as any).__EDDY_DEBUG__
      if (debug) {
        debug.editor = editor
      }
    }
  })

  // Derive layout from first layout clip in metadata tracks
  const layout = createMemo(() => {
    const metadataTracks = editor.project().metadataTracks ?? []
    for (const track of metadataTracks) {
      const layoutClip = track.clips.find(isClipLayout)
      if (layoutClip) {
        return layoutClip
      }
    }
    return undefined
  })

  // Helper to get track volume/pan from project store
  const getTrackVolume = (trackId: string) => {
    const pipeline = editor.getTrackPipeline(trackId)
    const gainIndex = pipeline.findIndex((e: { type: string }) => e.type === 'audio.gain')
    return gainIndex !== -1 ? editor.getEffectValue(trackId, gainIndex) : 1
  }

  const getTrackPan = (trackId: string) => {
    const pipeline = editor.getTrackPipeline(trackId)
    const panIndex = pipeline.findIndex((e: { type: string }) => e.type === 'audio.pan')
    // Convert 0-1 (store) to -1..1 (display)
    const value = panIndex !== -1 ? editor.getEffectValue(trackId, panIndex) : 0.5
    return (value - 0.5) * 2
  }

  return (
    <div class={styles.container}>
      <Show when={editor.isProjectLoading()}>
        <div class={styles.loadingOverlay}>Loading project...</div>
      </Show>
      <div class={styles.compositorContainer}>
        <canvas
          ref={element => onMount(() => setCanvas(element))}
          class={styles.compositorCanvas}
        />
      </div>
      <div class={styles.transport}>
        <button
          type="button"
          class={styles.playButton}
          data-playing={editor.player()?.isPlaying() ?? false}
          onClick={editor.playPause}
          disabled={editor.isRecording() || editor.selectedTrack() !== null}
        >
          {editor.player()?.isPlaying() ? <FiPause size={20} /> : <FiPlay size={20} />}
        </button>
        <button
          type="button"
          class={styles.recordButton}
          classList={{ [styles.recording]: editor.isRecording() }}
          data-recording={editor.isRecording()}
          onClick={editor.toggleRecording}
          disabled={
            editor.selectedTrack() === null ||
            editor.previewPending() ||
            editor.finalizingRecording()
          }
        >
          {editor.isRecording() ? <FiSquare size={20} /> : <FiCircle size={20} />}
        </button>
        <button
          type="button"
          class={styles.stopButton}
          onClick={editor.stop}
          disabled={editor.isRecording() || editor.selectedTrack() !== null}
        >
          <FiSquare size={20} />
        </button>
        <button
          type="button"
          class={styles.loopButton}
          classList={{ [styles.active]: editor.loopEnabled() }}
          onClick={editor.toggleLoop}
          disabled={editor.isRecording()}
          title={editor.loopEnabled() ? 'Disable loop' : 'Enable loop'}
        >
          <FiRepeat size={20} />
        </button>
        <div class={styles.timeDisplay}>
          <input
            type="text"
            class={styles.timeInput}
            value={formatTime(editor.player()?.time() ?? 0)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                const parsed = parseTime(e.currentTarget.value)
                if (parsed !== null) {
                  editor.player()?.seek(parsed)
                }
                e.currentTarget.blur()
              }
            }}
            onBlur={e => {
              const parsed = parseTime(e.currentTarget.value)
              if (parsed !== null) {
                editor.player()?.seek(parsed)
              }
            }}
            disabled={editor.isRecording()}
          />
          <span class={styles.timeSeparator}>/</span>
          <span class={styles.duration}>{formatTime(editor.player()?.maxDuration() ?? 0)}</span>
        </div>
        <label class={styles.masterVolume}>
          <FiVolume2 size={16} />
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={editor.masterVolume()}
            onInput={e => editor.setMasterVolume(parseFloat(e.target.value))}
          />
        </label>
        <button
          type="button"
          class={styles.publishButton}
          onClick={editor.publish}
          disabled={
            editor.isRecording() ||
            (editor.player()?.isPlaying() ?? false) ||
            editor.isPublishing() ||
            !editor.hasAnyRecording() ||
            !agent()
          }
        >
          <FiUpload size={16} />
          {editor.isPublishing() ? 'Publishing...' : 'Publish'}
        </button>
        <button
          type="button"
          class={styles.exportButton}
          classList={{ [styles.exporting]: editor.isExporting() }}
          onClick={() => (editor.isExporting() ? editor.cancelExport() : editor.export())}
          disabled={
            editor.isRecording() ||
            (editor.player()?.isPlaying() ?? false) ||
            !editor.hasAnyRecording()
          }
        >
          <FiDownload size={16} />
          <Show when={editor.isExporting()} fallback="Export">
            <span class={styles.exportProgress}>
              {editor.exportPhase()} {Math.round(editor.exportProgress() * 100)}%
            </span>
          </Show>
        </button>
      </div>
      <div
        class={styles.grid}
        style={{
          'grid-template-columns': `repeat(${layout()?.columns ?? 1}, 1fr)`,
          'grid-template-rows': `repeat(${layout()?.rows ?? 1}, 1fr)`,
        }}
      >
        <Index each={editor.project().mediaTracks}>
          {(track, index) => (
            <Track
              trackId={track().id}
              displayIndex={index}
              hasClip={editor.player()?.hasClipForTrack(track().id) ?? false}
              isPlaying={editor.player()?.isPlaying() ?? false}
              isSelected={editor.isSelectedTrack(track().id)}
              isRecording={editor.isRecording() && editor.isSelectedTrack(track().id)}
              isLoading={editor.previewPending() && editor.isSelectedTrack(track().id)}
              volume={getTrackVolume(track().id)}
              pan={getTrackPan(track().id)}
              visualPipeline={editor.getVisualPipeline(track().id)}
              onSelect={() => editor.selectTrack(track().id)}
              onVolumeChange={value => editor.setTrackVolume(track().id, value)}
              onPanChange={value => editor.setTrackPan(track().id, value)}
              onVideoEffectParamChange={(effectIndex, paramKey, value) =>
                editor.setVideoEffectParam(track().id, effectIndex, paramKey, value)
              }
              onClear={() => editor.clearRecording(track().id)}
              onDownload={() => editor.downloadClip(track().id)}
            />
          )}
        </Index>
      </div>
    </div>
  )
}
