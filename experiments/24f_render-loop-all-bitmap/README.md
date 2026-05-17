# render-loop-all-bitmap

**Question:** [25b](../25b_upload-real-sources/README.md) showed that
`Uint8Array` upload at K=16/270p (~4 ms) is competitive with the
decoded-VideoFrame atlas path (~4.5 ms at M=4 × 540p). **Can we drop
atlases entirely — every cell uploads from a raw-RGBA bitmap stream —
and still hold 60 fps end-to-end at K=4/9/16/25?**

If yes, the whole rebuild story (and its 24c/24d/24e failures, the
hybrid pattern's tightness in 24b, the atlas-swap discipline of
14/16) is moot — there's no atlas to rebuild, swap, or schedule.

## Why

Across the 24-series we've established:

| K | per-cell AV1 (24) | atlas AV1 (24a) | predicted bitmap (25b extrapolation) |
|---|---|---|---|
| 4 | 60 fps | 60 fps | likely 60 fps |
| 9 | 53 fps, 12% jank | 60 fps | likely 60 fps |
| 16 | 34 fps, 73% jank | 60 fps | likely 60 fps (~4 ms upload) |
| 25 | 24 fps, 88% jank | 60 fps | unknown (extrapolated > budget?) |

25b's data predicts the bitmap path should fit comfortably at K=16
and possibly at K=25. This experiment validates that prediction
end-to-end (upload + draw + rAF, no atlas).

If it works at K=25 too, the design simplifies enormously:

- No atlas → no rebuild → no rebuild scheduling, no rebuild contention, no atlas swap
- Hybrid pattern from 24b also evaporates (everything is "dirty", but all the cells are cheap)
- Storage is raw RGBA only (much larger than AV1 but bounded per session)
- Encode happens only at session-end / share time (offline batch, no live contention)

## Setup

Same K-sweep shape as 24 and 24a. Each K uses the cell-display-size
mip:

| K | Grid | Per-cell mip |
|---|---|---|
| 4 | 2×2 | 540p (960×544) |
| 9 | 3×3 | 360p (640×368) |
| 16 | 4×4 | 270p (480×272) |
| 25 | 5×5 | 180p (320×184) |

Per pass:
1. Decode source clip → downscale each frame to per-K mip res → store
   as raw RGBA in an in-memory array of `Uint8Array` (one entry per
   source frame). ~60 frames at 2 s loop is plenty.
2. All K cells share the same RGBA frame array (cheap; per 15 cross-
   cell entropy isn't load-bearing).
3. Render loop: per rAF tick, compute frame index from elapsed time
   (`floor(elapsed * 30 / 1000) mod totalFrames`), upload that
   frame's bytes via `texImage2D(RGBA, UNSIGNED_BYTE, Uint8Array)`
   to each of K textures, draw K quads with `gl.clear` first.

10 s per pass. JankRecorder + longtask observer per pass.

In-memory bytes only — no OPFS. If the upload+draw fits the budget,
a follow-up with OPFS read pipeline (per 18c's pattern) validates
the data layer.

## What's measured

Per pass (mirrors 24 / 24a for direct comparison):
- Render fps (mean / median)
- Frame-time stats: mean, p95, p99, max
- `over33msRatio`, `longestJankStreak`, `jankScore`
- Long-tasks observed
- Per-pass memory used (in-memory RGBA frames at the mip res)

## What to look for

- **K=4, 9, 16 hit 60 fps with <1% over 33 ms** → matches 24a's
  atlas baseline; the all-bitmap path fully replaces atlas for K up
  to 16. Architecture simplification confirmed.
- **K=25 hits 60 fps** → all-bitmap is fully viable; no need for
  atlas at any tested K.
- **K=25 wobbles** (similar to 24's K=16 collapse) → there's still
  a K ceiling for the bitmap path; atlas (or further mip reduction)
  is needed past that ceiling, but the threshold has moved up
  meaningfully.
- **Jank correlates with mip pixel area × K** → confirms the per-
  pixel upload model; informs how to pick mips per K.

## Caveats

- In-memory bytes only. OPFS read latency is not exercised here. 18c
  already showed 30 fps per cell at K=9 from OPFS works; K=16 OPFS
  read throughput (240 MB/s aggregate at 270p) is a follow-up.
- All K cells render the same source content (looped). Per 15 cross-
  cell entropy isn't load-bearing for upload; should not affect the
  perf comparison.
- Cells share a single in-memory frame array per pass (no per-cell
  storage cost in the test). Real eddy would have per-cell content
  in per-cell OPFS files; storage scales with K × session-length.
- No camera concurrent. 24e showed capture alone is cheap; this
  experiment is upload-budget validation, not the full hot path.
- Same source clip across all passes (recorded once); each pass
  decodes + downscales fresh into its mip.
- No decode running during render — frames pre-decoded once at
  setup. This matches the all-bitmap architecture (no live decoders).
- `gl.clear` per tick (mandatory per 18c finding).

## Reproduce

```sh
git checkout <result.json git.sha>
pnpm dev
TIMEOUT_MS=300000 PORT=<port> experiments/harness/run.sh 24f_render-loop-all-bitmap
```
