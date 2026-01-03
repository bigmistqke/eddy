# @eddy/playback

Synchronized A/V playback with frame buffering and audio scheduling.

## Exports

- `createPlayback(demuxer, options?)` - Create a synchronized player for video + audio

## Usage

```ts
import { createDemuxer } from '@eddy/codecs'
import { createPlayback } from '@eddy/playback'

const demuxer = await createDemuxer(blob)
const playback = await createPlayback(demuxer)

playback.onFrame((frame, time) => {
  // Render frame to canvas
})

await playback.play()
playback.pause()
await playback.seek(5.0)
playback.stop()
playback.destroy()
```

## Internal modules

- `frame-buffer` - Buffers decoded VideoFrames ahead of playback position
- `audio-scheduler` - Schedules AudioData chunks via Web Audio API

## Dependencies

- `@eddy/codecs` - Demuxer and decoder types
