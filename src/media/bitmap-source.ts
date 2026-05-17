import type { InputVideoTrack } from "mediabunny"

export interface BitmapFrame {
  bytes: Uint8Array
  width: number
  height: number
}

export interface BitmapSource {
  /** Returns the most recently advanced-to frame, or null before the
   *  first frame is ready. The returned bytes reference an internal
   *  buffer — callers must consume them within the same tick. */
  latestFrame(): BitmapFrame | null
  /** Advance the internal cursor to the frame nearest to tSeconds.
   *  Called from the render loop or transport tick. Idempotent for
   *  the same tSeconds. */
  seek(tSeconds: number): void
  /** Reset to the start — pre-loop hook. */
  reset(): void
  close(): void
}

export async function makeBitmapSource(_track: InputVideoTrack): Promise<BitmapSource> {
  throw new Error("makeBitmapSource: not implemented")
}

export function makeCameraBitmapSource(_stream: MediaStream): BitmapSource {
  throw new Error("makeCameraBitmapSource: not implemented")
}
