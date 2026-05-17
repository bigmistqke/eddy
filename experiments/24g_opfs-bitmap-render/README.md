# opfs-bitmap-render

**Question:** [24f](../24f_render-loop-all-bitmap/README.md) held
clean 60 fps at K=4/9/16/25 with all-bitmap rendering — but used
**in-memory** RGBA frames. **Does the same render loop hold when the
bytes come from OPFS via a reader worker, per [18c](../18c_opfs-bitmaps/README.md)'s
pattern?** That's the load-bearing piece between "the upload + draw
fits the budget" (24f's finding) and "the production storage layer
can sustain the data rate."

## Why

[18c](../18c_opfs-bitmaps/README.md) validated OPFS-backed bitmap
streaming at K=9 with concurrent capture. The all-bitmap design from
24f wants to extend this to K=25 with the bitmap path as the *only*
playback architecture (no atlas, no codec at render time).

At K=25 × 30 fps × 180p RGBA (~59 KB per frame), the reader needs to
sustain ~44 MB/s of OPFS reads + post-message bandwidth. K=16 × 270p
RGBA (~130 KB per frame) is ~63 MB/s. Both are well under modern
mobile SSD throughput, but the actual ceiling on an Android Chrome's
OPFS+SyncAccessHandle path is unmeasured at this K.

If this holds, the all-bitmap architecture is validated end-to-end
through the storage layer.

## Setup

Same K-sweep as 24f. Per pass:

1. Decode source clip → downscale to per-K mip res → write K OPFS
   files (one per cell, frames concatenated). Pre-population happens
   in setup, not during the render loop. Per-cell file size:
   `framesPerPass × mip_width × mip_height × 4`.
2. Spawn reader worker. Worker opens K `FileSystemSyncAccessHandle`s,
   maintains a per-cell cursor that advances at source-fps (30 Hz),
   reads the current frame for each cell when its cursor advances,
   posts the batch back to main as transferable ArrayBuffers.
3. Main maintains a per-cell "latest bytes" map updated on worker
   messages.
4. Render loop runs 10 s. Each rAF tick: for each cell, if a frame is
   available, `texImage2D(RGBA, UNSIGNED_BYTE, bytes)`.

After each pass, OPFS files are deleted so the test doesn't
accumulate gigabytes between runs.

## What's measured

Per pass (mirrors 24f for direct comparison):
- Render fps + standard JankRecorder stats
- Long-tasks observed
- **OPFS write time** at setup (informational — pre-population cost)
- **Frames received from worker** per cell (sanity — confirms the
  reader is keeping up)
- **Empty-cell ticks** — rAF ticks where a cell had no frame
  available; should be near zero in steady state

## What to look for

- **fps matches 24f at every K** → OPFS read pipeline keeps up
  through K=25; storage layer validated
- **fps degrades at high K vs 24f's in-memory** → reader is the
  bottleneck; need batching, larger ring buffer, or different worker
  count
- **Empty-cell ticks > 0** → reader didn't deliver in time; cells
  paint stale data (still smooth render-wise but content lags)
- **OPFS write time at K=25 is reasonable** (per 18c, sub-200 ms
  for K=9 × 6 s); larger writes scale accordingly

## Caveats

- All cells share the same source content (looped). Per 15
  cross-cell entropy isn't load-bearing for upload; OPFS-read-wise
  reads happen from K independent files regardless.
- No concurrent capture. 24h is the natural follow-up that adds
  capture; this experiment isolates the storage layer.
- Pre-population happens in main thread via the async OPFS writable
  API (`createWritable`). Real eddy capture would write from a
  worker via `SyncAccessHandle` (per 18c) — this experiment validates
  *read* side only.
- Worker posts ArrayBuffers transferably; per-tick post message
  count is at most K (frames batched per advance).
- Per-cell file size scales with `framesPerPass × pixel area × 4`.
  At K=25, 180p, 60 frames per cell ≈ 87 MB total OPFS (modest).
- `gl.clear` per tick (mandatory per 18c).
- Same source clip across all passes; each pass freshly decodes and
  writes new OPFS files for its mip.

## Reproduce

```sh
git checkout <result.json git.sha>
pnpm dev
TIMEOUT_MS=360000 PORT=<port> experiments/harness/run.sh 24g_opfs-bitmap-render
```
