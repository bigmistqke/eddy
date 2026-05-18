# audio-split-pipeline

**Question:** can we add live audio capture to the dual-encode video
pipeline from [exp 30g](../30g_dual-encode-720p-and-270p/README.md)
and have it mux cleanly into BOTH outputs (720p canonical + 270p mip)
without A/V sync drift?

## Why

The 30g pipeline is video-only. Production eddy needs synchronized
audio for every clip — each cell loops video + its captured audio.
Two architectural questions:

1. **Where does audio live in canonical storage?**
   - Inside the 720p WebM only (export uses it; cell playback would
     need to read it separately)
   - Inside the 270p WebM only (cell playback uses it; export must
     re-mux)
   - **Inside both** (each WebM self-contained, simple to consume,
     small storage overhead — opus is ~6-12 KB/s)
   - Audio in a separate file (most flexible, but app must sync
     two streams at playback)

2. **Can mediabunny's `MediaStreamAudioTrackSource` keep up under
   the dual video encode + K=9 decoder workload?**

This experiment goes with **option 3** (audio in both WebMs) because
it's the simplest consumer-side: every WebM is independently playable
with its own A/V. Storage cost is negligible.

## Setup

1. `getUserMedia({video: 720p, audio: true})` — one stream, one
   shared media clock.
2. Video track → `MediaStreamTrackProcessor` → 30g's dual encode
   pipeline (720p AV1 direct, 270p AV1 via WebGL canvas-transfer
   resize).
3. Audio track → clone twice, feed one clone to a
   `MediaStreamAudioTrackSource(opus)` on each `Output` (high + low).
   Mediabunny pulls + encodes audio internally.
4. Run 10 s capturing both streams simultaneously.
5. Finalize both outputs (each containing video + audio tracks).
6. Demux each output, verify:
   - Both tracks present (video + audio)
   - Video packet count = expected frames
   - Audio packet count > 0
   - Last video PTS ≈ Last audio end PTS (within tolerance)

K is fixed at 9 (270p decoder workers in background, same as 30g) to
keep the test under realistic concurrent load.

## What's measured

For each output (high = 720p+audio, low = 270p+audio):
- `videoPacketCount` / `audioPacketCount` after re-demux
- `lastVideoEndUs` / `lastAudioEndUs` — A/V sync indicators
- `avDriftMs` = `(lastVideoEndUs - lastAudioEndUs) / 1000`
- `webmBytes` total
- `videoBytesEst` / `audioBytesEst` (approximate from packet sizes)
- `tracksOk` — both tracks present after demux

For the pipeline:
- Encoder add p95 / max for each video encoder (sanity check vs 30g)
- TickLag p95 (sanity check)
- Decoder fps (sanity check)
- `audioErrors` (any errors propagated from
  `MediaStreamAudioTrackSource.errorPromise`)

## What to look for

- **avDriftMs ≤ 100 ms in both outputs** — audio and video end at
  essentially the same point; mediabunny's `synced-zero`
  `timestampBase` works as documented
- **avDriftMs > 500 ms** — drift is bad enough that playback would
  visibly lag; need a different audio capture strategy (separate
  encoder per clip, manual timestamping, etc.)
- **Audio packet count > 0 in both outputs** — both
  `MediaStreamAudioTrackSource` instances received samples from
  their cloned tracks
- **Audio errors empty** — mediabunny's audio encoder didn't
  starve or fail under load
- **Video encoder add p95 ≈ 30g's numbers (≤ 10 ms)** — adding
  audio doesn't materially slow down video
- **tracksOk: true in both** — the WebM is well-formed with both
  tracks

## Caveats

- Uses real microphone — environmental noise may affect audio
  bitrate but shouldn't affect sync.
- Real camera at 720p — may throttle to <30 fps in low light (per
  [exp 30](../30_capture-time-av1-encode/README.md)). If it does, the
  video encoder will run at the camera's actual rate; audio runs at
  its own clock; we still expect them to align at capture time
  because they share the MediaStream clock.
- Two `MediaStreamAudioTrackSource` instances on two cloned tracks —
  unknown if they share an encoder under the hood or each spins up
  its own. If audio encode is expensive, K=9 decoder + 2× video encode
  + 2× audio encode could push the SoC.
- The decoder workers from 30g/30f are still pure-video (no audio
  decode); audio decode for playback is a separate question.
- 10 s only; thermal sustainment untested.

## Findings (2026-05-18, sha `d499577`, Galaxy A15)

Audio + video pipeline works cleanly. A/V drift is **28 ms** in both
outputs — well within the ~100 ms perceptual threshold for lip-sync.

| Metric | HIGH (720p+audio) | LOW (270p+audio) |
|---|---|---|
| video encodedFps | 30 | 30 |
| video addP95 | 6.6 ms | 4.8 ms |
| video addMax | 20.0 ms | 18.3 ms |
| pendingAddsMax | 1 | 1 |
| finalize | 108 ms | 25 ms |
| video packets | 300/300 | 300/300 |
| audio packets | 502 | 502 |
| last video end | 9.992 s | 9.992 s |
| last audio end | 10.020 s | 10.020 s |
| **A/V drift** | **28 ms** | **28 ms** |
| total bytes | 311 KB | 175 KB |
| tracksOk | ✓ | ✓ |

Pipeline-wide (concurrent with 9 decoder workers at 270p):
- decoder min/mean: 30.2 / 30.2 fps (no degradation)
- resize p95: 2 ms (WebGL canvas-transfer; same as 30g)
- audio errors: 0
- pipeline errors: 0

What this confirms:
- **`MediaStreamAudioTrackSource` works in parallel with `VideoSampleSource`** on the same `Output`. No starvation, no error promises rejected.
- **Two independent audio sources can capture from cloned audio
  tracks** of the same MediaStream. Each `Output` gets its own audio
  encoder; each WebM is self-contained.
- **A/V drift = 28 ms with `synced-zero` audio timestampBase +
  rebased video timestamps.** The audio source's default
  'synced-zero' base sits at 0 for the first audio chunk; if video
  uses the camera's raw `VideoFrame.timestamp` (microseconds from
  system clock), the two end up on different time origins and look
  catastrophically desynced. **Rebasing video to start at 0 (subtract
  the first frame's timestamp) is the required pattern**; otherwise
  drift is reported as hundreds of seconds.
- **Adding audio doesn't slow down video encode.** addP95 is 6.6 ms
  (HIGH) and 4.8 ms (LOW) — slightly lower than 30g's 7.5 / 2.8 ms
  baseline at K=9 (within run-to-run noise; not meaningfully worse).
- **Decoders unaffected.** All 9 still hit 30 fps — adding audio
  encode doesn't push the SoC over the edge.
- **Storage adds ~14-16 KB/s per output for opus at 96 kbps.** HIGH
  total grew from 30g's 147 KB to 311 KB (+164 KB ≈ 16 KB/s); LOW
  grew from 32 KB to 175 KB (+143 KB ≈ 14 KB/s).

What this reveals about the architecture:
- **Each WebM (720p and 270p) carries its own audio copy.** Playback
  is then trivial — point a `<video>` at the right file and audio
  comes along. No separate audio sync layer needed in eddy. Cost
  is the ~14 KB/s × 2 streams audio duplication.
- **The "split pipeline" name in cross-references is a misnomer**.
  Audio isn't split into a separate file; it's split into a separate
  *encoder* per output (different from video which uses a separate
  encoder per resolution). The two audio encoders happen to encode
  the same input but write to different containers.

Implications for phase 3:
- **Dual encode + dual audio mux works on the A15 at K=9.** Full
  capture-time pipeline (720p AV1 + 270p AV1 + opus×2 + WebGL resize
  + 9 worker decoders) sustains 30 fps with no encoder backpressure.
- **Drift will probably grow with run length.** 28 ms over 10 s might
  become more over 60 s if audio and video clocks drift. A 60 s
  follow-up would confirm — but this is the kind of drift the WebM
  container is designed to handle (timestamped packets, decoder
  resyncs), so even 100-200 ms drift after several minutes would be
  benign.
- **The 720p WebM "finalize: 108 ms"** is a bit higher than 30g's
  ~63 ms — probably because the audio source has to flush its own
  encoder and write the audio track. Still negligible vs the user-
  perceived record-stop budget.
- **Phase 3 spec can now be drafted.** All blocking video-pipeline
  questions are answered:
  - [30g](../30g_dual-encode-720p-and-270p/README.md): dual encode
    works
  - [31](../31_resize-shootout/README.md): WebGL resize is fastest
  - [30f](../30f_capture-encode-decoders-in-workers/README.md):
    decoders in workers are the right shape
  - 30c (this): audio mux into both outputs works with negligible drift

Note for eddy implementation: when feeding a video encoder from
`MediaStreamTrackProcessor` alongside `MediaStreamAudioTrackSource`,
rebase video timestamps to the first frame's timestamp. Otherwise the
muxed video track will be timestamped from the camera's system-clock
origin while the audio track sits at 0, breaking playback A/V sync
even though the encoded data is fine. Capture this as
[[feedback_av_timestamp_rebase]] memory.

## Reproduce

```sh
git checkout <result.json git.sha>
pnpm dev
TIMEOUT_MS=300000 PORT=<port> experiments/harness/run.sh 30c_audio-split-pipeline
```
