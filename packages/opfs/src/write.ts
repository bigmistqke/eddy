/**
 * OPFS Write
 *
 * Utilities for writing to Origin Private File System.
 */

import { getClipHandle } from './paths'

/** Create a writable stream for a clip (for streaming writes) */
export async function createWritableStreamFromClip(
  clipId: string,
): Promise<FileSystemWritableFileStream> {
  const handle = await getClipHandle(clipId, { create: true })
  return handle.createWritable()
}

/** Write a blob to OPFS (for one-shot writes) */
export async function writeBlobToClip(clipId: string, blob: Blob): Promise<void> {
  const writable = await createWritableStreamFromClip(clipId)
  await blob.stream().pipeTo(writable)
}
