// Reader worker for 24g. Holds K SyncAccessHandles, advances per-
// cell cursors at source-fps, reads the current frame for each cell
// when its cursor advances, posts batches back to main as
// transferable ArrayBuffers.

import { wait } from "../../src/utils"

interface CellInit {
  cellId: number
  fileName: string
  frameSize: number
  totalFrames: number
}

interface InitMessage {
  type: "init"
  dirName: string
  cells: CellInit[]
  sourceFps: number
}

interface StopMessage {
  type: "stop"
}

type Request = InitMessage | StopMessage

interface ReadyMessage {
  type: "ready"
}

interface FrameItem {
  cellId: number
  bytes: ArrayBuffer
}

interface FramesMessage {
  type: "frames"
  frames: FrameItem[]
}

interface DoneMessage {
  type: "done"
  framesDelivered: Record<number, number>
}

let running = false

self.onmessage = async (event: MessageEvent<Request>) => {
  if (event.data.type === "stop") {
    running = false
    return
  }
  if (event.data.type !== "init") {
    return
  }

  const { dirName, cells, sourceFps } = event.data
  const handles = new Map<number, FileSystemSyncAccessHandle>()
  const cursors = new Map<number, number>()
  const frameSizes = new Map<number, number>()
  const totalFrames = new Map<number, number>()
  const lastAdvanceMs = new Map<number, number>()
  const framesDelivered = new Map<number, number>()

  const root = await navigator.storage.getDirectory()
  const dir = await root.getDirectoryHandle(dirName, { create: false })
  for (const cell of cells) {
    const fileHandle = await dir.getFileHandle(cell.fileName, { create: false })
    const handle = await fileHandle.createSyncAccessHandle()
    handles.set(cell.cellId, handle)
    cursors.set(cell.cellId, 0)
    frameSizes.set(cell.cellId, cell.frameSize)
    totalFrames.set(cell.cellId, cell.totalFrames)
    lastAdvanceMs.set(cell.cellId, 0)
    framesDelivered.set(cell.cellId, 0)
  }
  const ready: ReadyMessage = { type: "ready" }
  self.postMessage(ready)

  running = true
  const intervalMs = 1000 / sourceFps
  // Initial frame for each cell — send one batch immediately so the
  // render loop has something to upload from the start.
  {
    const frames: FrameItem[] = []
    for (const [cellId, handle] of handles) {
      const fs = frameSizes.get(cellId)!
      const buf = new ArrayBuffer(fs)
      handle.read(new Uint8Array(buf), { at: 0 })
      frames.push({ cellId, bytes: buf })
      framesDelivered.set(cellId, 1)
    }
    if (frames.length > 0) {
      const msg: FramesMessage = { type: "frames", frames }
      self.postMessage(msg, frames.map(f => f.bytes))
    }
  }

  while (running) {
    const now = performance.now()
    const frames: FrameItem[] = []
    for (const [cellId, handle] of handles) {
      const last = lastAdvanceMs.get(cellId) ?? 0
      if (now - last >= intervalMs) {
        const fs = frameSizes.get(cellId)!
        const total = totalFrames.get(cellId)!
        const next = ((cursors.get(cellId) ?? 0) + 1) % total
        cursors.set(cellId, next)
        const buf = new ArrayBuffer(fs)
        handle.read(new Uint8Array(buf), { at: next * fs })
        frames.push({ cellId, bytes: buf })
        lastAdvanceMs.set(cellId, now)
        framesDelivered.set(cellId, (framesDelivered.get(cellId) ?? 0) + 1)
      }
    }
    if (frames.length > 0) {
      const msg: FramesMessage = { type: "frames", frames }
      self.postMessage(msg, frames.map(f => f.bytes))
    }
    // Small yield. Tighter than intervalMs so we re-check often.
    await wait(2)
  }

  // Close handles, post final stats.
  for (const handle of handles.values()) {
    try {
      handle.close()
    } catch {}
  }
  const delivered: Record<number, number> = {}
  for (const [k, v] of framesDelivered) {
    delivered[k] = v
  }
  const done: DoneMessage = { type: "done", framesDelivered: delivered }
  self.postMessage(done)
}
