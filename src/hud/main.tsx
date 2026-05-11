import { createSignal, Show, useContext } from "solid-js"
import { PlayIcon, PlusIcon, RecordIcon, SplitIcon, StopIcon } from "../components/icons"
import { Notch } from "../components/notch"
import { Context } from "../context"
import { blobToClip } from "../clips/clip"
import { startCapture, type CaptureHandle } from "../media/capture"
import { logAction, selectedCellId } from "../utils"
import styles from "./main.module.css"

export function Main() {
  const context = useContext(Context)!
  const [captureHandle, setCaptureHandle] = createSignal<CaptureHandle | null>(null)

  function toggleTool(tool: "append" | "split") {
    const next = context.app.tool === tool ? null : tool
    logAction("set-tool", { tool: next })
    context.setTool(next)
  }

  async function onRecord() {
    const cellId = selectedCellId(context)
    if (cellId === null) {
      return
    }
    logAction("record-start", {})

    // Monitor: play existing clips (excluding the cell being recorded
    // into) so the user can overdub against the song so far. Caller is
    // expected to be wearing headphones — spec accepts the mic
    // picking up the speaker as a known limitation.
    const existing = Object.values(context.clips.clips).filter(clip => clip.cellId !== cellId)
    const length = context.songLength()
    if (existing.length > 0) {
      await context.transport.play(existing, length)
    }

    const handle = await startCapture()
    setCaptureHandle(handle)
    await context.preview.start(cellId, handle.stream)

    // Anchor-take: if songLength is set, auto-stop the new recording at
    // that length so it matches the anchor.
    if (length !== null) {
      window.setTimeout(() => {
        if (captureHandle() === handle) {
          void onStopRecording()
        }
      }, length * 1000)
    }
  }

  async function onStopRecording() {
    const handle = captureHandle()
    if (handle === null) {
      return
    }
    const cellId = context.preview.activeCellId()
    logAction("record-stop", {})
    setCaptureHandle(null)
    context.preview.stop()
    context.transport.stop() // stop monitor playback if it was running
    const blob = await handle.stop()
    if (cellId === null) {
      return
    }
    const clip = await blobToClip(cellId, blob)
    context.clips.setClip(cellId, clip)
    if (context.songLength() === null) {
      context.setSongLength(clip.duration)
    }
  }

  async function onPlay() {
    const allClips = Object.values(context.clips.clips)
    if (allClips.length === 0) {
      return
    }
    logAction("play", {})
    await context.transport.play(allClips, context.songLength())
  }

  function onStopPlayback() {
    logAction("stop", {})
    context.transport.stop()
  }

  return (
    <Notch ref={context.setHudElement("main")} class={styles.notch}>
      <div class={styles.content}>
        <Show
          when={captureHandle() !== null}
          fallback={
            <>
              <Show
                when={context.transport.state() === "stopped"}
                fallback={
                  <button class={styles.button} data-action="stop" onClick={onStopPlayback}>
                    <StopIcon />
                  </button>
                }
              >
                <button class={styles.button} data-action="play" onClick={onPlay}>
                  <PlayIcon />
                </button>
              </Show>
              <button class={styles.button} data-action="record-start" onClick={onRecord}>
                <RecordIcon />
              </button>
            </>
          }
        >
          <button class={styles.button} data-action="record-stop" onClick={onStopRecording}>
            <StopIcon />
          </button>
        </Show>
        <span class={styles.divider} />
        <button
          class={[styles.button, context.app.tool === "append" ? styles.active : ""].join(" ")}
          data-action="set-tool-append"
          onClick={() => toggleTool("append")}
        >
          <PlusIcon />
        </button>
        <button
          class={[styles.button, context.app.tool === "split" ? styles.active : ""].join(" ")}
          data-action="set-tool-split"
          onClick={() => toggleTool("split")}
        >
          <SplitIcon />
        </button>
      </div>
    </Notch>
  )
}
