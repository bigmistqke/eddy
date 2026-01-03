# @klip/codecs

Container parsing and WebCodecs decoding for media files.

## Exports

- `createDemuxer(source: ArrayBuffer | Blob)` - Parse WebM/MP4 containers via mediabunny
- `createVideoDecoder(demuxer, trackInfo)` - Decode video samples to VideoFrame
- `createAudioDecoder(demuxer, trackInfo)` - Decode audio samples to AudioData

## Usage

```ts
import { createDemuxer, createVideoDecoder } from '@klip/codecs'

const demuxer = await createDemuxer(arrayBuffer)
const videoTrack = demuxer.info.videoTracks[0]
const decoder = await createVideoDecoder(demuxer, videoTrack)

const samples = await demuxer.getSamples(videoTrack.id, 0, 1)
for (const sample of samples) {
  const frame = await decoder.decode(sample)
  // use frame...
  frame.close()
}
```

## Dependencies

- `mediabunny` - Container parsing (WebM, MP4, MKV, etc.)
