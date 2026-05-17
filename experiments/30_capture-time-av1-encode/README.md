# capture-time-av1-encode

**Question:** can we encode camera frames to AV1 **as they're being
captured** — replacing the current MediaRecorder + post-record
transcode shape with a `MediaStreamTrackProcessor` → downscale →
`VideoEncoder` → mediabunny mux pipeline that runs in real time? At
typical eddy cell-mip resolutions (270p / 180p), AV1 software encode
should have meaningful headroom over realtime — per
[experiment 20d](../20d_resolution-codec-pool/README.md), throughput
scales sharply with smaller frame size.

## Why

C2 phase 3 needs persistent AV1 storage. The simplest path
(per the [phase 3 spec](../../docs/superpowers/specs/2026-05-18-c2-phase3-design.md))
is to keep MediaRecorder and transcode the resulting VP8 WebM blob
to AV1 at record-stop. That works but adds ~6 s of record-stop
latency for a 6 s clip and decodes-then-re-encodes redundantly.

The alternative — encode as you capture — is architecturally
cleaner (one pipeline, no decode roundtrip) and removes record-stop
latency, but requires:
- AV1 SW encode to keep up with the live camera at the chosen
  resolution
- A working downscale step (canvas) between camera frame and encoder
- mediabunny mux receiving live chunks and producing a finalized
  WebM blob on flush

[Experiment 20](../20_codec-survey/README.md) showed AV1 encode at
720p ≈ 32 fps — barely realtime at native camera resolution. But at
the cell-mip resolutions eddy actually uses (270p / 180p), the per-
pixel work is 4-16× smaller, so encode throughput should sit well
above realtime with margin for thermal drift and concurrent app
load.

This experiment measures that headroom directly.

## Setup

Single capture session ~10 s. Three resolution variants run in
sequence:

| Pass | Encode resolution | Notes |
|---|---|---|
| 540p | 960 × 544 | upper bound — bigger than typical cell |
| 270p | 480 × 272 | typical K=16 cell |
| 180p | 320 × 184 | typical K=25 cell |

For each pass:

1. `getUserMedia({video, audio})` — same as existing capture
2. `new MediaStreamTrackProcessor({track: videoTrack})` → reader
3. Per `VideoFrame` from reader:
   - Draw + downscale to target res via `OffscreenCanvas`
   - Wrap as a new `VideoFrame` (downscaled)
   - `videoEncoder.encode(frame)` (AV1, `prefer-software`)
   - Close both frames
4. Encoder `output` callback: push chunks into a `mediabunny`
   `WebMOutput`'s video track input
5. Run for `captureSeconds` (10 s)
6. Flush encoder, finalize mux, get the resulting WebM `Blob`
7. Re-demux the blob via mediabunny to sanity-check that the AV1
   stream is valid + plays the right number of frames

## What's measured

Per pass:
- `cameraFps` — frames per second arriving from `TrackProcessor`
  (`framesObserved / captureSeconds`)
- `encodedFps` — frames per second the encoder accepted (`chunks /
  captureSeconds`)
- `dropRatio` — `(cameraFps - encodedFps) / cameraFps` (positive
  means encoder couldn't keep up and frames were dropped)
- `encodeQueueMaxSize` — peak `VideoEncoder.encodeQueueSize` seen
  (encoder backpressure indicator)
- `webmBytes` — output WebM blob size
- `webmBytesPerSecond` — `webmBytes / captureSeconds`
- `firstFrameMs` — time from `record-start` to first encoded chunk
  (initial setup cost)
- `finalizeMs` — time from `record-stop` to fully-flushed WebM blob
- `roundTripVerified` — whether the resulting WebM can be re-demuxed
  by mediabunny + frame count matches encoded count

Audio is OUT of scope for this experiment — focus on the video
encode path. Phase 30c addresses audio.

## What to look for

- **180p / 270p `dropRatio` ≤ 1%, `encodeQueueMaxSize` ≤ 4** —
  encoder keeps up cleanly; on-the-fly is comfortably realtime
  at typical cell sizes
- **540p `dropRatio` > 5%** — at full mip res, AV1 SW encode is
  tight; might need to choose a smaller mip when going on-the-fly
- **`firstFrameMs` ≤ 200 ms** — encoder setup + first encode is
  fast enough that record-start feels instant
- **`finalizeMs` ≤ 300 ms** — record-stop's flush + finalize is
  basically free vs the current ~6 s transcode latency
- **`webmBytesPerSecond` close to experiment 20's per-second
  numbers** — confirms the on-the-fly encoder produces equivalently-
  sized output (no surprise inflation from live encoding)
- **`roundTripVerified` true** — the produced WebM is a valid file
  the rest of the app can later demux + decode

## Caveats

- Camera resolution isn't user-controllable — `getUserMedia` returns
  whatever the device supports near the request. The downscale step
  bridges to the target encode resolution, but the downscale cost is
  included in the per-frame budget.
- Single camera, single run per resolution. No thermal accumulation
  beyond ~30 s total. Sustained behavior at 60+ s is a follow-up.
- AV1 encode `bitrate` chosen to match experiment 20's per-pixel
  rate (~0.1 bits/pixel/frame). Lower rates would speed up encode
  but degrade quality.
- No concurrent playback — that's [experiment 30b](../30b_capture-encode-under-playback/README.md).
- No audio — that's [experiment 30c](../30c_audio-split-pipeline/README.md).
- AV1 `prefer-software` chosen because device has no AV1 HW (per
  experiment 20). The encoder defaults to whatever WebCodecs picks;
  for AV1 on this device that should be SW.

## Findings (2026-05-18, sha `a3520e6`, Galaxy A15)

Encoder is comfortable at all three resolutions — but with a major
caveat about the input rate.

| Pass | cameraFps | encodedFps | drops | add p95 | finalize | webm B/s | roundTrip |
|---|---|---|---|---|---|---|---|
| 540p | 8.3 | 8.3 | 0% | 4.0 ms | 47 ms | 37 KB/s | ✓ 83/83 |
| 270p | 8.3 | 8.3 | 0% | 3.8 ms | 26 ms | 9 KB/s | ✓ 83/83 |
| 180p | 8.3 | 8.3 | 0% | 3.9 ms | 20 ms | 5 KB/s | ✓ 83/83 |

The good:
- **AV1 encode is fast enough.** p95 `add` latency is ~4 ms at 540p
  and falls to ~3.9 ms at 180p — so per-frame encode + mux cost is
  well under a 33 ms frame budget. The pipeline (TrackProcessor →
  OffscreenCanvas downscale → `VideoSample` → mediabunny encode/mux)
  works end-to-end on first attempt.
- **Finalize is cheap.** 20-47 ms for the WebM blob to be written and
  flushed — that's the ~6 s record-stop latency from
  [phase 3 spec](../../docs/superpowers/specs/2026-05-18-c2-phase3-design.md)
  effectively gone.
- **First-frame latency is good.** 130-200 ms from camera-open to
  first encoded chunk — fast enough that record-start feels instant.
- **Round-trip verified.** All 83 packets re-demux cleanly via
  mediabunny in all three passes — output is well-formed AV1 in WebM.
- **Output size is small.** 37 KB/s at 540p, 5 KB/s at 180p — within
  expected ranges for AV1 at ~0.1 bits/pixel.

The caveat:
- **cameraFps is 8.3, not 30.** The phone camera is delivering ~8
  frames/s during this run — probably auto-exposure throttling under
  indoor lighting on the Galaxy A15. The serial loop (`await
  reader.read()` then `await videoSource.add(sample)`) paces on
  whichever side is slower; with camera @ 8 fps and encoder @ 250 fps
  capacity (1 / 4 ms), the camera is the bottleneck and the encoder
  has ~30× headroom that this run can't measure.
- **This is not a 30-fps stress test of the encoder.** It's a "encoder
  is comfortably faster than the camera" test. Encoder behavior under
  sustained 30 fps input — and under thermal accumulation — is still
  unmeasured.

Implications for phase 3:
- The capture-time AV1 path is **viable** at typical eddy cell-mip
  resolutions: encoder pipeline works, output is correct, finalize is
  near-instant. This unblocks the "encode-as-you-capture" architecture
  in the [phase 3 spec](../../docs/superpowers/specs/2026-05-18-c2-phase3-design.md)
  as a real alternative to the "MediaRecorder + post-record transcode"
  shape.
- Before committing to it, we still need:
  - [30b](../30b_capture-encode-under-playback/README.md): does it
    keep up while K=4-9 cells are decoding/rendering concurrently?
  - [30c](../30c_audio-split-pipeline/README.md): can we mux audio
    in the same pipeline without drift?
  - A stress test at forced-30-fps input (synthetic frame generator)
    to measure encoder headroom directly — flagged for follow-up
    experiment 30d if the on-the-fly path is chosen.

Note for eddy implementation: the per-pass setup (`new Output`, `new
VideoSampleSource`, `output.start()`, `output.finalize()`) takes ~150
ms first time and ~50-100 ms subsequently. If we record many short
clips back-to-back, the muxer startup cost is small but not zero —
batch where possible.

## Reproduce

```sh
git checkout <result.json git.sha>
pnpm dev
TIMEOUT_MS=180000 PORT=<port> experiments/harness/run.sh 30_capture-time-av1-encode
```
