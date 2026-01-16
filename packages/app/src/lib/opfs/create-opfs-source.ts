/**
 * Create OPFS Source
 *
 * Creates a mediabunny Source backed by OPFS File.
 * Uses getFile() which allows concurrent reads (unlike SyncAccessHandle which is exclusive).
 */

import { BlobSource, type Source } from 'mediabunny'
import { getClipHandle } from './paths'

/** Create a mediabunny Source backed by OPFS file */
export async function createOPFSSource(clipId: string): Promise<Source> {
  const handle = await getClipHandle(clipId)
  const file = await handle.getFile()
  return new BlobSource(file)
}
