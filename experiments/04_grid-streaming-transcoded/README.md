# grid-streaming-transcoded

**Question:** same as [03_grid-streaming](../03_grid-streaming/README.md)
— does the real workload (N cells summing to one viewport) sustain
realtime? — but with **correct cell resolutions**.

## Why a separate experiment

03 recorded each cell directly from the camera, which only offers a few
discrete sensor modes — so N=9 and N=16 ran the *identical* clip and the
cross-N comparison was confounded. A real streaming pipeline must
**downscale after capture** anyway. This experiment does that
(`harness/transcode.ts`): record once, then transcode down to each
grid's true cell size.

Kept separate from 03 (rather than replacing it) so the train of thought
stays visible: 03 = naive camera-clamp attempt + why it's flawed, 04 =
the corrected version.

## Setup

Records once at `captureResolution`, then for each N in `gridSizes`
(4, 9, 16, 25) transcodes the clip to `total / √N` per axis (snapped to
16-px macroblock alignment — see below), runs N decoders looping the
transcoded clip concurrently for `runSeconds`, and reports per-decoder
sustained fps, min, aggregate, `realtimeOk` (min ≥ 28), and `transcodeMs`.

**Note on the transcode penalty:** an earlier run found re-encoded clips
decode *slower* than camera-native clips of similar size. Two fixes
landed in `harness/transcode.ts`: bitrate now scales with resolution
(a fixed bitrate over-bitrated small cells), and dimensions snap to
multiples of 16 (VP8's macroblock size — odd/unaligned dims force
padding that decodes slower). This experiment's `result.json` is the
run *after* both fixes.

## Verdict (2026-05-14 · Galaxy A15 · Android 10 · Chrome 148)

Run with bitrate-scaled + macroblock-aligned transcode (`result.json`):

| N | cell (mult-16) | min fps | aggregate | realtime? | px/s throughput | transcodeMs |
|---|---|---|---|---|---|---|
| 4 | 544×976 | **31.8** | 136 | ✅ | 72.0M | 3392 |
| 9 | 368×656 | 20.6 | 204 | ❌ | 49.3M | 1681 |
| 16 | 272×496 | 14.2 | 276 | ❌ | 37.2M | 1637 |
| 25 | 224×400 | **10.7** | 361 | ❌ | 32.3M | 1662 |

**Streaming sustains realtime only at N=4** — same shape as 03, now with
trustworthy cell sizes. N≥9 falls short and the gap widens. Effective
px/s throughput *falls* as cells shrink (72M → 32M) → the wall is
**per-decode/per-stream overhead, not pixel bandwidth**. Spreading the
same pixels across more, smaller decoders is strictly worse.

### The re-encode penalty (important, and unsolved)

Even after both fixes (resolution-scaled bitrate + 16-px macroblock
alignment, which lifted px throughput ~20%), **transcoded clips still
decode ~1.5–1.7× harder per pixel than camera-native ones.** Compare
N=25 here (224×400, 90K px → 10.7 fps) with 03's camera-native N=25
(480×264, 127K px → 17.5 fps): the transcoded clip is *smaller* yet
decodes *slower*.

The likely cause is **not** the downscale — it's the **re-encode**:
WebCodecs `VideoEncoder` (software VP8) produces a bitstream the
hardware decoder handles less efficiently than the camera's
hardware-encoded MediaRecorder output. If that's right, **the composite
pays this penalty too** — it is also `VideoEncoder` output.
`compositing-full-video` must measure it.

### Cost

`transcode` runs ~1.6–3.4 s for 150 frames — a real cost, but one-time
per clip at record, not per playback frame.

**Bottom line:** streaming N independent decoders does not scale past
N≈4 on this device, and re-encoding (which any non-camera-native
pipeline needs) adds a standing decode tax. Strong evidence for the
composite — but the composite must be measured under the same
re-encode tax.

## Reproduce

```sh
git checkout <result.json git.sha>
pnpm dev
PORT=<port> experiments/harness/run.sh 04_grid-streaming-transcoded
```
