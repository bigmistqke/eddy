/**
 * Make OPFS Source
 *
 * Creates a mediabunny Source backed by OPFS File.
 * Uses getFile() which allows concurrent reads (unlike SyncAccessHandle which is exclusive).
 */

import { BlobSource, type Source } from 'mediabunny'
import { getClipHandle } from './paths'

/** Make a mediabunny Source backed by OPFS file */
export async function makeOPFSSource(clipId: string): Promise<Source> {
  const handle = await getClipHandle(clipId)
  const file = await handle.getFile()
  return new BlobSource(file)
}
