// Decode a source clip, downscale each frame, emit an ImageBitmap per
// frame. Transferred back to the main thread for paint testing.
//
// Modelled after harness/composite.ts but without the re-encode step:
// decode → draw to small canvas → grab bitmap. No VP8 generation, no
// VideoEncoder.

import type { ProbeInput } from "../harness/input"

interface BuildRequest {
  source: ProbeInput
  bitmapWidth: number
  bitmapHeight: number
}

interface BuildResponse {
  buildMs: number
  bitmaps: ImageBitmap[]
  bitmapWidth: number
  bitmapHeight: number
}

self.onmessage = async (event: MessageEvent<BuildRequest>) => {
  const { source, bitmapWidth, bitmapHeight } = event.data
  const start = performance.now()
  const canvas = new OffscreenCanvas(bitmapWidth, bitmapHeight)
  const context = canvas.getContext("2d")
  if (context === null) {
    throw new Error("bitmap-worker: no 2d context")
  }
  const bitmaps: ImageBitmap[] = []
  const decoder = new VideoDecoder({
    output(frame) {
      context.drawImage(frame, 0, 0, bitmapWidth, bitmapHeight)
      frame.close()
      const bitmap = canvas.transferToImageBitmap()
      bitmaps.push(bitmap)
    },
    error(error) {
      throw error
    },
  })
  decoder.configure(source.config)
  for (const chunk of source.chunks) {
    decoder.decode(chunk)
  }
  await decoder.flush()
  decoder.close()
  const buildMs = performance.now() - start
  const response: BuildResponse = { buildMs, bitmaps, bitmapWidth, bitmapHeight }
  // Transfer bitmaps so we don't pay for a structured-clone copy of
  // every frame on the way back. The TS DedicatedWorker postMessage
  // signature wants Transferable[] — ImageBitmap is transferable at
  // runtime but lib.dom is conservative about it.
  ;(self as unknown as { postMessage(m: unknown, t: Transferable[]): void })
    .postMessage(response, bitmaps as unknown as Transferable[])
}
