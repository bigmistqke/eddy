/**
 * OPFS Write
 *
 * Utilities for writing to Origin Private File System.
 */

import { getClipHandle } from './paths'

/** Create a writable stream for a clip (for streaming writes) */
export async function createWritableStreamToOPFS(
  clipId: string,
): Promise<FileSystemWritableFileStream> {
  const handle = await getClipHandle(clipId, { create: true })
  return handle.createWritable()
}

/** Write a blob to OPFS (for one-shot writes) */
export async function writeBlobToOPFS(clipId: string, blob: Blob): Promise<void> {
  const writable = await createWritableStreamToOPFS(clipId)
  await blob.stream().pipeTo(writable)
}
