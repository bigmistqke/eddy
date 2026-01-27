# Eddy Architecture

A multi-track video editor built on WebCodecs, Web Audio, and SolidJS.

> Diagrams generated with [diagonjs](https://github.com/ArthurSonzogni/Diagon).
> Edit `docs/architecture-source.md` and run `node scripts/render-architecture.ts docs/architecture-source.md ARCHITECTURE.md`

## System Overview

```diagon:graphDAG
MainThread -> Player
Player -> Clock
Player -> TimelineCompiler
Player -> ClipsStore
Player -> WorkerPools
Player -> RenderLoop
Player -> VideoWorker
Player -> AudioWorker
Player -> Compositor
VideoWorker -> Compositor
AudioWorker -> RingBuffer
RingBuffer -> AudioWorklet
AudioWorklet -> Speakers
```

## Package Structure

```diagon:tree
packages
  app (SolidJS application)
    components
    hooks
      create-player
      create-clock
      action
    lib
      timeline-compiler
      create-playback
    workers
      playback.video.worker
      playback.audio.worker
      compositor.worker
  audio (Audio playback & mixing)
    create-audio-playback
    create-audio-bus
    create-effect-chain
    scheduler
  video (Video decoding & rendering)
    create-video-playback
    create-decoder
    create-compositor
    frame-utils
  media (Container demuxing/muxing)
    demuxer
    muxer
  utils (Shared utilities)
    loop
    debug
    guards
  lexicons (ATProto schemas)
```

## Package Dependencies

```diagon:graphDAG
@eddy/utils -> @eddy/media
@eddy/utils -> @eddy/video
@eddy/utils -> @eddy/audio
@eddy/media -> @eddy/video
@eddy/media -> @eddy/audio
@eddy/lexicons -> @eddy/audio
@eddy/video -> @eddy/app
@eddy/audio -> @eddy/app
```

## Data Flow

### Playback Pipeline

```diagon:graphDAG
Blob -> Player.loadClip
Player.loadClip -> AcquireWorkers
AcquireWorkers -> VideoWorker.load
AcquireWorkers -> AudioWorker.load
VideoWorker.load -> Demux
AudioWorker.load -> Demux
Demux -> Decoder
Decoder -> FrameBuffer
Player.play -> VideoWorker.play
Player.play -> AudioWorker.play
VideoWorker.play -> Compositor.setFrame
AudioWorker.play -> RingBuffer.write
RingBuffer.write -> AudioWorklet.read
Compositor.setFrame -> WebGL.render
```

### Frame Transfer (Worker → Compositor)

```diagon:graphDAG
VideoPlayback -> onFrame
onFrame -> transfer(frame)
transfer(frame) -> MessagePort
MessagePort -> Compositor.setFrame
Compositor.setFrame -> texImage2D
texImage2D -> frame.close
```

Direct worker-to-worker transfer via MessagePort. No main thread copy overhead.

### Audio Transfer (Worker → Scheduler → Worklet)

```diagon:graphDAG
AudioPlayback -> decode
decode -> RingBuffer.write
RingBuffer.write -> Atomics.store(WRITE_PTR)
AudioWorklet.process -> RingBuffer.read
RingBuffer.read -> Atomics.store(READ_PTR)
AudioWorklet.process -> output
```

Lock-free single-producer single-consumer ring buffer via SharedArrayBuffer.

## Worker Architecture

```diagon:graphDAG
MainThread -> VideoWorker
MainThread -> AudioWorker
MainThread -> CompositorWorker
VideoWorker -> MessagePort
MessagePort -> CompositorWorker
AudioWorker -> SharedArrayBuffer
SharedArrayBuffer -> AudioWorklet
```

### Video Playback Worker

Methods:
- `load(buffer)` → demux, extract video track, init decoder
- `connectToCompositor(port)` → establish direct frame transfer
- `play(time, speed)` → start buffering, send frames via port
- `pause()` → stop buffering
- `seek(time)` → seek to keyframe, decode to target
- `getFrameAtTime(time)` → decode single frame (for export)

### Audio Playback Worker

Methods:
- `setRingBuffer(sampleBuf, controlBuf, sampleRate)` → init ring buffer
- `load(buffer)` → demux, extract audio track, init decoder
- `play(time, speed)` → start buffering, write to ring buffer
- `pause()` → stop buffering
- `seek(time)` → seek to sample position
- `getAudioAtTime(time)` → decode samples (for export)

### Compositor Worker

Methods:
- `init(canvas, width, height)` → set up WebGL2 context
- `setTimeline(timeline)` → update clip placements
- `setFrame(clipId, frame)` → receive frame from video worker
- `setPreviewStream(trackId, stream)` → set camera preview
- `connectPlaybackWorker(clipId, port)` → establish MessagePort
- `render(time)` → composite and display
- `renderAndCapture(time)` → composite and return VideoFrame

## Ring Buffer Protocol

**Control Buffer** (Int32Array, 4 elements):
- `[0]` WRITE_PTR - Worker write position (Atomics.store)
- `[1]` READ_PTR - Worklet read position (Atomics.store)
- `[2]` CHANNELS - Number of audio channels (1 or 2)
- `[3]` PLAYING - 0 = silent, 1 = output samples

**Sample Buffer** (Float32Array):
- Interleaved: `[L0, R0, L1, R1, L2, R2, ...]`
- Capacity: ~1 second of audio at target sample rate

**Protocol:**
- Writer (audio worker): write samples → `Atomics.store(WRITE_PTR)`
- Reader (AudioWorklet): read samples → `Atomics.store(READ_PTR)`
- No locks needed: single producer, single consumer

## Gapless Loop Transitions

```diagon:graphDAG
Clock.tick -> detectLoop
detectLoop -> prepareNextPlayback
prepareNextPlayback -> loadNextClip
Clock.tick -> loopReset
loopReset -> swapPlayback
swapPlayback -> connectToCompositor
swapPlayback -> destroyOldPlayback
```

1. **Detect loop** - `time < previousTime` indicates loop occurred
2. **Prepare** - 2 seconds before loop end, preload next playback
3. **Handoff** - Swap playbacks, connect new one to compositor
4. **Cleanup** - Destroy old playback, release workers to pool

## Core Abstractions

### Factory Pattern (createX)

All major components use factory functions returning object literals:

```typescript
export function createVideoPlayback(config: Config): VideoPlayback {
  // Private state via closure
  let decoder: VideoDecoder | null = null
  let frameBuffer: FrameData[] = []

  // Private functions
  function bufferAhead(targetTime: number) { ... }

  // Public API
  return {
    load(buffer: ArrayBuffer) { ... },
    play(time: number, speed?: number) { ... },
    seek(time: number) { ... },
    destroy() { ... },
  }
}
```

### Worker RPC (@bigmistqke/rpc)

```typescript
// Main thread
const videoWorker = rpc<VideoPlaybackWorkerMethods>(
  new Worker('./playback.video.worker.ts')
)
await videoWorker.load(transfer(buffer))
await videoWorker.play(0, 1.0)

// Worker thread
expose<VideoPlaybackWorkerMethods>({
  load(buffer) { playback.load(buffer) },
  play(time, speed) { playback.play(time, speed) },
})
```

## Key Dependencies

| Library | Purpose |
|---------|---------|
| **mediabunny** | MP4/WebM demuxing and muxing |
| **solid-js** | Reactive UI framework (signals, stores, effects) |
| **@bigmistqke/rpc** | Typed RPC over MessagePort for worker communication |
| **WebCodecs API** | Hardware-accelerated video/audio decoding |
| **Web Audio API** | AudioContext, AudioWorklet, GainNode, etc. |
| **valibot** | Schema validation for ATProto lexicons |

## Design Principles

1. **Worker isolation** - Heavy processing (demux, decode, render) runs off main thread
2. **Lock-free audio** - SharedArrayBuffer ring buffer avoids messaging overhead
3. **Direct frame transfer** - Worker-to-worker MessagePort eliminates main thread copy
4. **Factory closures** - Private state via closures, no class inheritance
5. **Reactive timeline** - SolidJS signals drive automatic recompilation
6. **Pooled workers** - Reuse worker instances to avoid initialization overhead
7. **Gapless loops** - Proactive preparation enables seamless transitions
