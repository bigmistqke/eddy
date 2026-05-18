# resize-shootout

**Question:** which 720p→270p downscale technique is fastest on the
Galaxy A15 when fed real-camera `VideoFrame`s, and which is suitable
for the dual-encode capture pipeline from
[exp 30g](../30g_dual-encode-720p-and-270p/README.md)?

## Why

[Exp 30g](../30g_dual-encode-720p-and-270p/README.md) used
`createImageBitmap(frame, {resizeWidth, resizeHeight, resizeQuality:
'low'})` and found it ~2.5 ms p95 — essentially free. But:

- That was a **synthetic** input (already an `OffscreenCanvas`).
  Real camera `VideoFrame`s may be NV12 or another GPU-internal
  format; the resize fast path could behave differently.
- We never measured other techniques in apples-to-apples comparison.
  The architecture decision in 30g rested on one method.
- The user's instinct: "we need a separate test that analyzes the
  cost of different resizing techniques (canvas API, webgl, webgpu,
  …)". This experiment is that test.

## Setup

1. `getUserMedia({video: {width: 1280, height: 720}})`.
2. `MediaStreamTrackProcessor` to read `VideoFrame`s.
3. For each captured camera `VideoFrame` (up to `targetFrames` total):
   - Run **every technique** against a clone of that frame
   - Measure each technique's wall-clock cost
   - Push the produced 270p `VideoFrame` into a per-technique AV1
     `VideoSampleSource` for round-trip validation
4. After `targetFrames`, finalize each per-technique encoder and
   verify the WebM round-trips (frame count + decoder accepts).

Techniques tested (in order, per frame):

| Method | Description |
|---|---|
| `passthrough-clone` | `frame.clone()` — no resize, baseline for per-call overhead |
| `createImageBitmap-low` / `-medium` / `-high` | `createImageBitmap(frame, {resize…, quality})` then `new VideoFrame(bitmap)` |
| `canvas2d-wrap-low` | `ctx.drawImage` with smoothing+`low` quality, wrap canvas as VideoFrame |
| `canvas2d-wrap-high` | same but `imageSmoothingQuality: 'high'` |
| `canvas2d-wrap-nosmooth` | smoothing disabled (nearest-neighbor) |
| `canvas2d-transfer` | `ctx.drawImage` then `transferToImageBitmap` then `new VideoFrame(bitmap)` |
| `webgl-canvas-wrap-sync` | WebGL2: upload as `TEXTURE_2D`, draw full-canvas quad, `gl.finish()`, wrap canvas |
| `webgl-canvas-wrap-nosync` | same without `gl.finish()` |
| `webgl-mipmap-sync` | upload + `generateMipmap` + sample with `LINEAR_MIPMAP_LINEAR` |
| `webgl-canvas-transfer-sync` | render to canvas, `transferToImageBitmap`, wrap bitmap |
| `webgpu-render-external-sync` | `importExternalTexture` + render pass + `onSubmittedWorkDone()` |
| `webgpu-render-external-nosync` | same without sync |
| `webgpu-render-copy2d-sync` | `copyExternalImageToTexture` into 2D texture + render pass + sync |
| `webgpu-compute-copy2d-sync` | copy-then-2d + compute shader + blit + sync |

Running all techniques per frame keeps comparisons fair (same input
content, same camera state). The cost is that per-frame work is
heavy, which may drop camera frames — but that only reduces sample
size, not measurement validity, since each technique's cost is
recorded independently.

## What's measured

Per technique:
- `setupMs` — one-time setup cost (program compile, context
  initialization)
- `p50Ms`, `p95Ms`, `maxMs` — per-frame resize cost
- `samples` — frames the technique successfully ran on
- `availableInWorker` — was the technique callable in this context
  (skipped if unavailable, e.g. WebGPU)
- `encodeRoundTrip` — `{framesSubmitted, framesEncoded, roundTripDemuxed, ok}`
- `errors`

Per session:
- `cameraSettings` — width/height/frameRate actually negotiated
- `framesCaptured` — total camera frames pulled

## What to look for

- **createImageBitmap-low ≤ 3 ms p95** — confirms 30g's finding for
  real camera input
- **createImageBitmap-medium / -high cost ≫ low** — quality knob is
  not free; production should stick with `low`
- **canvas2d-wrap is cheaper than canvas2d-transfer** — wrapping a
  canvas as a VideoFrame avoids the explicit ImageBitmap step
- **webgl ≪ canvas2d** — GPU bypass beats 2D context
- **webgl ≈ createImageBitmap-low** — both hit the same hardware
  fast path, so neither is dramatically better
- **webgpu unavailable** — Android Chrome 148 might not have WebGPU
  enabled; expected to be skipped
- **All round-trip OK** — every method produces a valid VideoFrame
  the encoder accepts (otherwise the method can't be used in the
  pipeline regardless of speed)

## Caveats

- Cost includes the `new VideoFrame(…)` wrap, which is what
  production actually needs. Methods that produce an
  `ImageBitmap` first pay the wrap cost too.
- Real camera frames vary frame-to-frame (auto-exposure, motion);
  doesn't affect timing meaningfully but may affect encoded bytes.
- Single 5 s session, single device. Thermal effects untested.
- Visual quality is NOT compared here. Per-pixel fidelity assessment
  is out of scope — we're measuring throughput. A separate visual
  check (sample one frame per method, eyeball it) is a follow-up.
- WebGL setup uses raw WebGL2 (not the codebase's `view.gl`
  abstraction) so the per-frame cost reflects pure GPU work, not
  abstraction overhead.

## Findings (2026-05-18, Galaxy A15)

### Exhaustive 16-technique run (sha `61b654f`)

All techniques except passthrough produce valid VideoFrames that
round-trip through AV1 encode/demux. Per-frame resize costs (150
samples, real camera at 1280×720 → 480×272):

| Technique | p50 | p95 | max | round-trip |
|---|---|---|---|---|
| passthrough-clone *(baseline)* | 0.0 ms | 0.1 ms | 0.3 ms | n/a |
| **webgl-canvas-wrap-nosync** | **0.7 ms** | 1.6 ms | 4.8 ms | ✓ |
| **webgl-mipmap-sync** | **0.7 ms** | 1.7 ms | 5.4 ms | ✓ |
| **webgl-canvas-transfer-sync** | **0.7 ms** | 1.7 ms | 4.2 ms | ✓ |
| **webgl-canvas-wrap-sync** | **0.8 ms** | 1.9 ms | 3.0 ms | ✓ |
| **webgpu-render-external-nosync** | **0.9 ms** | 1.7 ms | 3.1 ms | ✓ |
| canvas2d-wrap-nosmooth | 1.4 ms | 3.0 ms | 6.4 ms | ✓ |
| canvas2d-wrap-high | 1.7 ms | 3.3 ms | 4.8 ms | ✓ |
| canvas2d-wrap-low | 2.1 ms | 3.5 ms | 5.8 ms | ✓ |
| canvas2d-transfer | 2.8 ms | 4.7 ms | 6.7 ms | ✓ |
| createImageBitmap-medium | 3.5 ms | 6.3 ms | 8.9 ms | ✓ |
| createImageBitmap-high | 3.6 ms | 6.3 ms | 10.3 ms | ✓ |
| createImageBitmap-low *(30g default)* | 3.9 ms | 6.4 ms | 7.7 ms | ✓ |
| webgpu-compute-copy2d-sync | 17.8 ms | 24.2 ms | 33.0 ms | ✓ |
| webgpu-render-copy2d-sync | 22.6 ms | 33.4 ms | 90.4 ms | ✓ |
| webgpu-render-external-sync | 30.2 ms | 65.4 ms | 72.3 ms | ✓ |

### Headline findings

1. **WebGL wins, ~0.7-0.8 ms p50 across all variants.** Sync vs
   no-sync, with/without mipmap, canvas-wrap vs transfer-to-bitmap —
   all within margin of each other. WebGL is the production-correct
   path.

2. **WebGPU dispatch is actually fast (0.9 ms no-sync).** The 17-30 ms
   sync variants are almost entirely `queue.onSubmittedWorkDone()`
   overhead, not GPU work. The dispatch + draw + submit phases of
   WebGPU are competitive with WebGL.

3. **WebGPU `onSubmittedWorkDone()` is intrinsically expensive on
   this driver.** WebGL's `gl.finish()` adds zero measurable cost
   (sync 0.8 ms vs no-sync 0.7 ms); WebGPU's equivalent adds 30 ms
   p50. This is likely a Chrome-on-Android WebGPU implementation
   quirk — possibly a fence/wait being processed off the GPU thread.

4. **Skipping the sync isn't free.** The cost has to be paid somewhere.
   When the next pipeline stage (mediabunny encoder) reads the
   VideoFrame's underlying texture/canvas, it triggers an implicit
   sync. The "no-sync" numbers measure dispatch only; total pipeline
   cost shifts to the encoder. For WebGL where sync ≈ free, this
   doesn't matter. For WebGPU, the cost hides but doesn't disappear.

5. **WebGPU `copyExternalImageToTexture` is slower than
   `importExternalTexture`** when both are synced. Compute pipeline
   helps (17.8 vs 22.6 ms) but doesn't fix the underlying sync cost.

6. **createImageBitmap quality knob has no impact** on cost
   (3.5-3.9 ms across low/med/high) — pick the quality you want,
   performance is the same.

7. **canvas2d-wrap-nosmooth (nearest neighbor) is the fastest 2D
   canvas path** (1.4 ms p50) but produces lower-quality output.
   With smoothing it's 1.7-2.1 ms p50.

8. **canvas2d-wrap (any variant) is ~2× faster than createImageBitmap.**
   Wrapping the canvas as a VideoFrame avoids the bitmap creation step
   entirely.

9. **passthrough-clone is essentially free (0.0 ms p50, 0.3 ms max).**
   Confirms `VideoFrame.clone()` has no measurable overhead — every
   non-zero number for real techniques is genuine resize work.

### Why the original 30b "270p copy" path was so slow

That used `ctx.drawImage` + `ctx.getImageData` — NOT a technique
measured here, because `getImageData` forces a full CPU readback (the
entire RGBA byte array). Avoid `getImageData` for VideoFrame
production at all costs; wrap the canvas as a VideoFrame instead.

### Implications for phase 3

- **Switch the 30g dual-encode resize from `createImageBitmap-low`
  (3.9 ms p50) to `webgl-canvas-wrap-sync` (0.8 ms p50)** — saves
  ~3 ms per frame, frees ~90 ms/s of main-thread budget at 30 fps.
- **Fall back to `canvas2d-wrap-low` (2.1 ms p50)** if WebGL setup
  fails. Strictly better than `createImageBitmap` (any variant) and
  has zero setup cost.
- **Skip WebGPU on this device for synchronous use.** The fast
  no-sync mode pushes cost downstream where it costs the encoder,
  not the resize step. Until Chrome-on-Android fixes the WebGPU sync
  cost, WebGL is strictly better. Worth re-measuring on newer Android
  versions / future Chrome releases.
- **For `createImageBitmap` fallback, use `medium` or `high`** —
  same cost as `low` so no reason to sacrifice quality.

Note for eddy implementation: WebGL setup is 100-400 ms one-time —
significant if paid per record-start. Initialize the resize context
once at app boot and reuse it across all record sessions; don't
build/teardown per clip.

## Reproduce

```sh
git checkout <result.json git.sha>
pnpm dev
TIMEOUT_MS=180000 PORT=<port> experiments/harness/run.sh 31_resize-shootout
```
