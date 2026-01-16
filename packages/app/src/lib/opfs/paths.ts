/**
 * OPFS Paths
 *
 * Path and directory management for Origin Private File System storage.
 */

const CLIPS_DIRECTORY = 'clips'

/** Get the root OPFS directory */
async function getRoot(): Promise<FileSystemDirectoryHandle> {
  return navigator.storage.getDirectory()
}

/** Get or create the clips directory */
export async function getClipsDirectory(): Promise<FileSystemDirectoryHandle> {
  const root = await getRoot()
  return root.getDirectoryHandle(CLIPS_DIRECTORY, { create: true })
}

/** Get file handle for a clip (creates if needed when create=true) */
export async function getClipHandle(
  clipId: string,
  options: { create?: boolean } = {},
): Promise<FileSystemFileHandle> {
  const clipsDir = await getClipsDirectory()
  return clipsDir.getFileHandle(`${clipId}.webm`, { create: options.create ?? false })
}

/** Delete a clip from OPFS */
export async function deleteClip(clipId: string): Promise<void> {
  const clipsDir = await getClipsDirectory()
  await clipsDir.removeEntry(`${clipId}.webm`)
}

/** List all clip IDs in OPFS */
export async function listClips(): Promise<string[]> {
  const clipsDir = await getClipsDirectory()
  const clips: string[] = []

  for await (const entry of clipsDir.values()) {
    if (entry.kind === 'file' && entry.name.endsWith('.webm')) {
      clips.push(entry.name.replace('.webm', ''))
    }
  }

  return clips
}

/** Read a clip blob from OPFS, returns null if not found */
export async function readClipBlob(clipId: string): Promise<Blob | null> {
  try {
    const handle = await getClipHandle(clipId)
    return handle.getFile()
  } catch {
    return null
  }
}
