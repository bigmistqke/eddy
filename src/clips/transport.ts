import { createSignal } from "solid-js"
import { audioContext, audioDestination, resumeAudio } from "../media/audio-context"
import type { Clip } from "./clip"

export type TransportState = "stopped" | "playing"

export interface Transport {
  state(): TransportState
  /** Seconds since the current play pass began. 0 when stopped. Resets
   *  to 0 at each loop boundary when `loopLength` is set. */
  position(): number
  /** Begin playback. If `loopLength` is provided, schedules a fresh
   *  pass every `loopLength` seconds. Otherwise plays once and stops. */
  play(clips: Clip[], loopLength?: number | null): Promise<void>
  stop(): void
  /** Mute the clip in the given cell (gain 0) while playback continues
   *  silently in lock with the song. Pass null to unmute. Used while a
   *  cell is in live-preview state so the recorded audio doesn't
   *  collide with the user's monitor; unmuting resumes audio in sync
   *  with the rest of the song. */
  setMutedCell(cellId: string | null): void
  /** Set the user-facing volume (0..) for a cell. Defaults to 1 if
   *  not previously set. Persists across reschedules; combines
   *  multiplicatively with the mute (muted cell stays silent
   *  regardless of volume). Ramped briefly to avoid clicks. */
  setCellVolume(cellId: string, value: number): void
  /** Register a per-cell seek callback. The transport invokes it on
   *  every play/loop cycle and at stop. Multiple registrations per
   *  cell are kept until the returned dispose function is called. */
  registerSeek(cellId: string, seek: (tSeconds: number) => void): () => void
}

const SCHEDULE_LEAD_SECONDS = 0.05

export function createTransport(): Transport {
  const [state, setState] = createSignal<TransportState>("stopped")
  const [startedAt, setStartedAt] = createSignal(0)
  let sources: AudioBufferSourceNode[] = []
  /** Per-cell GainNode keyed by cellId. Lets `setMutedCell` flip a
   *  single cell's audio without re-scheduling sources, so the muted
   *  clip stays in sample-lock with the rest of the song. Cleared
   *  when sources are stopped (each schedule re-creates them). */
  let cellGains: Record<string, GainNode> = {}
  /** Per-cell user-facing volume. Survives reschedules — only
   *  cellGains rebuild on each schedule. */
  const cellVolumes: Record<string, number> = {}
  let mutedCell: string | null = null
  let loopTimer = 0
  const seekCallbacks: Map<string, ((t: number) => void)[]> = new Map()

  function fanOutSeek(t: number): void {
    for (const cbs of seekCallbacks.values()) {
      for (const cb of cbs) {
        cb(t)
      }
    }
  }

  function registerSeek(cellId: string, seek: (t: number) => void): () => void {
    const arr = seekCallbacks.get(cellId) ?? []
    arr.push(seek)
    seekCallbacks.set(cellId, arr)
    return () => {
      const current = seekCallbacks.get(cellId)
      if (current === undefined) {
        return
      }
      const next = current.filter(c => c !== seek)
      if (next.length === 0) {
        seekCallbacks.delete(cellId)
      } else {
        seekCallbacks.set(cellId, next)
      }
    }
  }

  function effectiveGain(cellId: string): number {
    if (cellId === mutedCell) {
      return 0
    }
    return cellVolumes[cellId] ?? 1
  }

  function scheduleSources(clips: Clip[], when: number) {
    const audio = audioContext()
    const out = audioDestination()
    for (const clip of clips) {
      const source = audio.createBufferSource()
      const gain = audio.createGain()
      gain.gain.value = effectiveGain(clip.cellId)
      source.buffer = clip.audio
      source.connect(gain)
      gain.connect(out)
      source.start(when)
      sources.push(source)
      cellGains[clip.cellId] = gain
    }
  }

  function stopActiveSources() {
    for (const source of sources) {
      try {
        source.stop()
      } catch {
        // not yet started
      }
    }
    sources = []
    cellGains = {}
  }

  function rampGain(cellId: string) {
    const gain = cellGains[cellId]
    if (gain === undefined) {
      return
    }
    // Short ramp to avoid a click on the transition.
    gain.gain.setTargetAtTime(effectiveGain(cellId), audioContext().currentTime, 0.005)
  }

  function setMutedCell(cellId: string | null) {
    const previous = mutedCell
    mutedCell = cellId
    if (previous !== null) {
      rampGain(previous)
    }
    if (cellId !== null) {
      rampGain(cellId)
    }
  }

  function setCellVolume(cellId: string, value: number) {
    cellVolumes[cellId] = value
    rampGain(cellId)
  }

  async function play(clips: Clip[], loopLength: number | null = null) {
    if (state() === "playing") {
      stop()
    }
    if (clips.length === 0) {
      return
    }
    await resumeAudio()
    const audio = audioContext()
    const firstWhen = audio.currentTime + SCHEDULE_LEAD_SECONDS
    scheduleSources(clips, firstWhen)
    setStartedAt(firstWhen)
    setState("playing")
    fanOutSeek(0)

    if (loopLength !== null) {
      const cycle = () => {
        if (state() !== "playing") {
          return
        }
        stopActiveSources()
        const audioNow = audioContext()
        const nextWhen = audioNow.currentTime + 0.01
        scheduleSources(clips, nextWhen)
        setStartedAt(nextWhen)
        fanOutSeek(0)
        loopTimer = window.setTimeout(cycle, loopLength * 1000)
      }
      loopTimer = window.setTimeout(cycle, loopLength * 1000)
    } else {
      const longest = Math.max(...clips.map(clip => clip.duration))
      loopTimer = window.setTimeout(() => {
        stop()
      }, (longest + 0.1) * 1000)
    }
  }

  function stop() {
    stopActiveSources()
    window.clearTimeout(loopTimer)
    loopTimer = 0
    setState("stopped")
    setStartedAt(0)
    fanOutSeek(0)
  }

  function position() {
    if (state() !== "playing") {
      return 0
    }
    // Audio is scheduled at startedAt = currentTime + SCHEDULE_LEAD_SECONDS,
    // so during the lead window currentTime - startedAt is negative.
    // Clamp to 0 so video frame lookups land on frame 0 instead of null.
    return Math.max(0, audioContext().currentTime - startedAt())
  }

  return { state, position, play, stop, setMutedCell, setCellVolume, registerSeek }
}
