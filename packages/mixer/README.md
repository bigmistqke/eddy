# @eddy/mixer

Web Audio API mixer for multi-track audio output.

## Exports

- `createAudioPipeline()` - Create a per-track audio chain (gain + pan)
- `getAudioContext()` - Get shared AudioContext singleton
- `getMasterMixer()` - Get master bus with volume control

## Usage

```ts
import { createAudioPipeline, getMasterMixer } from '@eddy/mixer'

const pipeline = createAudioPipeline()
pipeline.setVolume(0.8) // 0-1
pipeline.setPan(-0.5) // -1 (left) to 1 (right)
pipeline.connect(audioElement)

getMasterMixer().setMasterVolume(0.9)
```

## Signal flow

```
MediaElement → [gain] → [pan] → MasterMixer → AudioContext.destination
```
