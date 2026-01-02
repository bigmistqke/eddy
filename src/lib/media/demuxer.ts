import { createFile, type ISOFile, type Movie, type Track, MP4BoxBuffer } from 'mp4box'

export interface VideoTrackInfo {
  id: number
  codec: string
  width: number
  height: number
  duration: number
  timescale: number
  sampleCount: number
  bitrate: number
}

export interface AudioTrackInfo {
  id: number
  codec: string
  sampleRate: number
  channelCount: number
  sampleSize: number
  duration: number
  timescale: number
  sampleCount: number
  bitrate: number
}

export interface DemuxerInfo {
  duration: number
  timescale: number
  isFragmented: boolean
  videoTracks: VideoTrackInfo[]
  audioTracks: AudioTrackInfo[]
}

export interface Demuxer {
  readonly info: DemuxerInfo
  readonly file: ISOFile
  destroy(): void
}

type VideoTrack = Track & { video: NonNullable<Track['video']> }
type AudioTrack = Track & { audio: NonNullable<Track['audio']> }

function isVideoTrack(track: Track): track is VideoTrack {
  return track.video !== undefined
}

function isAudioTrack(track: Track): track is AudioTrack {
  return track.audio !== undefined
}

function parseVideoTrack(track: VideoTrack): VideoTrackInfo {
  return {
    id: track.id,
    codec: track.codec,
    width: track.video.width,
    height: track.video.height,
    duration: track.duration / track.timescale,
    timescale: track.timescale,
    sampleCount: track.nb_samples,
    bitrate: track.bitrate,
  }
}

function parseAudioTrack(track: AudioTrack): AudioTrackInfo {
  return {
    id: track.id,
    codec: track.codec,
    sampleRate: track.audio.sample_rate,
    channelCount: track.audio.channel_count,
    sampleSize: track.audio.sample_size,
    duration: track.duration / track.timescale,
    timescale: track.timescale,
    sampleCount: track.nb_samples,
    bitrate: track.bitrate,
  }
}

function parseInfo(info: Movie): DemuxerInfo {
  const videoTracks: VideoTrackInfo[] = []
  const audioTracks: AudioTrackInfo[] = []

  for (const track of info.tracks) {
    if (isVideoTrack(track)) {
      videoTracks.push(parseVideoTrack(track))
    } else if (isAudioTrack(track)) {
      audioTracks.push(parseAudioTrack(track))
    }
  }

  return {
    duration: info.duration / info.timescale,
    timescale: info.timescale,
    isFragmented: info.isFragmented,
    videoTracks,
    audioTracks,
  }
}

export async function createDemuxer(source: ArrayBuffer | File): Promise<Demuxer> {
  const file = createFile()

  const buffer = source instanceof File ? await source.arrayBuffer() : source

  return new Promise((resolve, reject) => {
    file.onError = (module: string, message: string) => {
      reject(new Error(`MP4Box error in ${module}: ${message}`))
    }

    file.onReady = (mp4Info: Movie) => {
      const info = parseInfo(mp4Info)

      resolve({
        info,
        file,
        destroy() {
          file.flush()
        },
      })
    }

    const mp4Buffer = MP4BoxBuffer.fromArrayBuffer(buffer, 0)
    file.appendBuffer(mp4Buffer)
    file.flush()
  })
}
