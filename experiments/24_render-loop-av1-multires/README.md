# render-loop-av1-multires

**Question:** does the architecture suggested by
[20d](../20d_resolution-codec-pool/README.md) — single AV1-SW pool,
each cell decoded at its display-resolution mip — actually survive
end-to-end through `texImage2D` upload + rAF paint? This is the bridge
between "decode throughput exists" and "production architecture
works."

## Why

20d found AV1-SW at 360p delivers 1690 fps (K=56 cell-equivalents) and
at 540p delivers 820 fps (K=27) — but those were decode-and-close
benchmarks. A real renderer also has to:

- `texImage2D` each decoded frame into a GPU texture
- Bind + draw each cell quad
- Present at vsync (16.7 ms budget on 60Hz)

`texImage2D` from a VideoFrame is *supposed* to be fast (often
zero-copy), but at K=16-25 cells × 30 fps that's 480-750 uploads/sec
into different textures. The browser also has to schedule decode IPC,
output callback dispatch, and rAF — all main-thread. Decode-only
benchmarks don't surface frame-pace contention here.

If this experiment confirms K=16 holds (60Hz rAF, sub-1% jank) at
270p cell mip, the production architecture is essentially settled
for this device:

- **No atlas** — per-cell streaming
- **No cross-codec, no time-slicing** — single AV1-SW pool
- **Multi-resolution storage** — each cell decoded at its display
  mip
- **Decoders driven from rAF** — single clock source, matches 17b's
  finding

If it fails (visible jank, dropped frames), we know `texImage2D`
upload + GPU upload bus is the next bottleneck and atlas grouping is
back on the table.

## Setup

1. Record one 720p VP8 source clip (6s).
2. Transcode to four AV1 mips:
   - **540p** (960×544) — for K=4
   - **360p** (640×368) — for K=9
   - **270p** (480×272) — for K=16
   - **180p** (320×184) — for K=25
3. For each K in `[4, 9, 16, 25]`:
   - Build an `gridCols × gridRows` grid layout on a fullscreen canvas
   - Spawn K AV1-SW decoders, each fed a copy of the appropriate mip
   - Render loop: rAF tick → drive each decoder via 17b's
     `feedTo(elapsedMs, 30fps)` pattern → `texImage2D` latest frame
     per cell → draw all K quads with `gl.clear` first
   - Run for 10s; record per-frame time + longtasks
4. Use [harness/jank.ts](../harness/jank.ts) for honest metrics
   (over33msRatio, longestJankStreak, jankScore).

## What's measured

Per K:
- Mip resolution used
- Render fps (mean / median)
- Frame-time distribution: mean, p95, p99, max
- `over33msRatio` (perceived smoothness signal per 18d)
- `longestJankStreak` (longest freeze)
- `jankScore` (single number for ranking)
- Long-tasks observed (main-thread > 50ms tasks)
- Aggregate decode load (sum of per-decoder frames over the run)

## What to look for

- **K=16, 60fps, <1% over-33ms, jankScore < 1** → the architecture
  works at scale. Architecture story is done for this device.
- **K=4-9 smooth, K=16+ janks** → texture upload or browser
  scheduling caps us before decode does; investigate `copyTo` or
  shared-texture paths
- **Longtasks correlate with jank streaks** → something on main
  (probably texImage2D + drawArrays loop) needs offloading
- **No longtasks but jank still present** → GPU-side bottleneck;
  decoders / textures contending for the GPU bus

## Verdict

**Decode keeps up at every K; the rAF tick is the new ceiling.**

| K | mip | rAF fps | mean | p95 | max | >33ms | streak | decode fps | target |
|---|---|---|---|---|---|---|---|---|---|
| 4 | 540p | **60.1** | 17.5 | 16.7 | 532* | 0.2% | 1 | 119 | 120 |
| 9 | 360p | **53.4** | 18.7 | 33.3 | 49.9 | 12.2% | 2 | 267 | 270 |
| 16 | 270p | **33.8** | 29.5 | 33.4 | 83.2 | **72.8%** | 8 | 474 | 480 |
| 25 | 180p | **24.1** | 41.4 | 66.6 | 99.9 | **87.6%** | 25 | 738 | 750 |

\* K=4's 532ms max is a single first-frame setup hitch; p95=16.7 says steady state is clean.

Decoders pace to target at every K (119≈120, 267≈270, 474≈480, 738≈750) — **decode isn't the bottleneck.** The render loop itself falls off the cliff between K=9 and K=16. The per-cell `texImage2D` + `drawArrays` cost compounds: at K=16, the rAF callback runs ~50 GL ops per tick (16 texture uploads + 16 draws + 16 decoder feeds), pushing past the 30fps budget.

**Revised architecture for A15:**

- **K ≤ 9: per-cell streaming + per-cell AV1-SW mip works end-to-end.** No atlas needed. 53-60fps with sub-15% >33ms frames.
- **K ≥ 12-16: atlas is back on the table.** Collapsing N `texImage2D` into one atlas upload is load-bearing again — exactly what 10/11/18g found for the VP8 era. The difference: AV1-SW makes the atlas decode/rebuild substantially cheaper than it was with VP8.

This **does not invalidate** the 20-series codec/pool work — it just relocates where the win lands. The codec story lowers the *decode* cost at every K; the atlas story handles the *paint* cost above K=12.

## Note for eddy implementation

- 1-cell, 2-cell, 4-cell, 6-cell, 9-cell layouts: ship per-cell streaming. No atlas, no time-slicing, no cross-codec.
- 12-cell and above: atlas grouping (K=2-4 sub-atlases per 11) but the atlas itself can decode via AV1-SW with per-resolution mip per sub-atlas. Much cheaper than VP8 atlas was.
- Skip the first 60 rAF ticks before measuring jank — first-frame texImage2D + shader compile cost shows up as a single huge hitch (this run: 532ms at K=4) that distorts jankScore. Doesn't change verdict, but the harness should drop warm-up frames in future runs.
- The decoder pacing pattern (rAF tick drives `feedTo(elapsedMs, 30fps)`) confirmed working at every K up to 25. Single-clock-source for decode + paint matches 17b's verdict.

## Caveats

- All K cells decode the same source clip (just at the per-K mip).
  Real sessions have heterogeneous content, but per-cell decode cost
  shouldn't depend on content (much). 15 confirmed cross-cell
  entropy isn't load-bearing for atlas; same likely holds here.
- Camera permission must be granted (recording happens at the top).
- Single layout shape (uniform grid). Container-aligned layouts add
  cell-aspect heterogeneity; not in scope here.
- Single-tick decoder pacing (one decoder may issue 2-3 decode
  requests per tick during catch-up). Production probably needs
  smoother pacing; that's a follow-up.
- Sub-rect sampling (the atlas trick) isn't used — each cell has its
  own texture. Saves shader complexity; costs N texture binds per
  frame. Acceptable for K=16 (16 binds/frame ≈ trivial); follow-up
  if it dominates.
- Decoders aren't pre-warmed. First few rAF ticks may paint with no
  frame available; jank metrics drop those.

## Reproduce

```sh
git checkout <result.json git.sha>
pnpm dev
TIMEOUT_MS=240000 PORT=<port> experiments/harness/run.sh 24_render-loop-av1-multires
```
