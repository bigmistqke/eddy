import type { Input } from "mediabunny"
import { decodeToAudioBuffer } from "../media/audio-decoder"
import { demuxBlob } from "../media/demuxer"
import { makeBitmapSource, type BitmapCacheMetadata, type BitmapSource } from "../media/bitmap-source"
import { logTrace } from "../utils"

export interface Clip {
  cellId: string
  /** Per-recording uuid. Distinct from cellId so re-recording the same
   *  cell allocates a fresh rgba cache file, sidestepping the OPFS
   *  SyncAccessHandle lock held by the previous clip's reader worker. */
  clipId: string
  duration: number
  audio: AudioBuffer
  video: BitmapSource
  /** Width/height/totalFrames/sourceFps of the rgba cache backing
   *  `video`. Used by the projects store to persist into CellRecord
   *  so the hot path can read these without re-decoding. */
  videoCacheMetadata: BitmapCacheMetadata
  /** Underlying mediabunny Input — held to keep tracks alive until close. */
  input: Input
}

/**
 * Build a Clip from a recorded Blob: demux, decode audio, pre-decode
 * video samples. Returned Clip is ready for synchronous playback.
 */
export async function blobToClip(cellId: string, blob: Blob): Promise<Clip> {
  logTrace("clip-demux-begin", { cellId, blobSize: blob.size, blobType: blob.type })
  const demuxed = await demuxBlob(blob)
  logTrace("clip-demux-done", { cellId, durationSeconds: demuxed.durationSeconds })
  const clipId = crypto.randomUUID()
  const [audio, videoResult] = await Promise.all([
    decodeToAudioBuffer(demuxed.audioTrack).then(a => {
      logTrace("clip-audio-decoded", { cellId, duration: a.duration, channels: a.numberOfChannels, sampleRate: a.sampleRate })
      return a
    }),
    makeBitmapSource(demuxed.videoTrack, clipId).then(result => {
      logTrace("clip-video-decoded", { cellId, clipId, ...result.metadata })
      return result
    }),
  ])
  return {
    cellId,
    clipId,
    duration: Math.max(audio.duration, demuxed.durationSeconds),
    audio,
    video: videoResult.source,
    videoCacheMetadata: videoResult.metadata,
    input: demuxed.input,
  }
}

export function disposeClip(clip: Clip): void {
  clip.video.close()
}
