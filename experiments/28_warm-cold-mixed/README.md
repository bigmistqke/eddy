# warm-cold-mixed

**Question:** in the C2 architecture, what happens if a session
loads incrementally — some cells already warmed (RGBA cached +
playing), and additional cells just starting cold-start (AV1 →
RGBA)? **Does the in-flight cold-start jank the active bitmap
render at K=8 + 4 warming?**

## Why

24e's analog (atlas + AV1 rebuild during playback) failed
super-linearly. The all-bitmap architecture (24f-h) has no rebuild
during steady state, but cold-start IS a transient AV1-decode work
that runs concurrent with playback during an incremental session
load. Per 26b, K=4 cold-start takes ~3.4 s with the optimised
worker + copyTo path. Does that 3.4 s window jank the playback of
the already-warmed cells?

This experiment closes Q4 from the design list: incremental session
load viability for the C2 design.

## Setup

Three isolating passes, all at the M=8 visible-grid baseline with
the additional 4 cells being warmed in pass 3:

| Pass | Bitmap render (M=8 cells from cache) | Concurrent cold-start (4 cells warming) |
|---|---|---|
| 1 baseline | yes (8 cells, all warm) | no |
| 2 cold-start-only | no | yes (4 cells, mirrors 26b K=4) |
| 3 full | yes (8 cells warm) | yes (4 cells warming via copyTo workers, kicked off at T+2 s) |

Setup phase (one-time):
- Record VP8 source
- Decode → RGBA at 270p, write M=8 RGBA OPFS files (for the
  always-warm playback set)
- Transcode → AV1 at 270p, write 4 AV1 OPFS files (for the cold-
  start set)

Pass 1: spawn 24g-style render with M=8 cells from the RGBA files;
run 15 s.

Pass 2: spawn 4 26b-style warm workers; await completion; record
cold-start ms.

Pass 3: start render loop with M=8 warm cells; at T+2 s, spawn 4
warm workers (cold-start the additional 4 cells); record both the
render jank and the cold-start completion time.

## What's measured

Per pass:
- Render fps + JankRecorder stats (mean/p95/max/over33msRatio/streak/score)
- Long-tasks observed
- Empty-cell ticks (sanity per 24g)
- For passes 2/3: cold-start wall time + per-cell decode/write times

For pass 3 specifically, compare:
- render jank during the cold-start window (T=2-6 s roughly) vs steady-state (T=6-15 s)
- cold-start wall time vs 26b's K=4 baseline (~3.4 s) — was playback overhead detectable?

## What to look for

- **Pass 3 render fps ≈ pass 1** → cold-start is a clean background
  workload; incremental session load is viable
- **Pass 3 cold-start wall time ≈ pass 2** → playback doesn't slow
  cold-start
- **Pass 3 janks meaningfully during the cold-start window** → the
  worker decode contends with bitmap upload more than expected;
  may need to stagger or throttle the warm
- **Cold-start ≤ 1 s slower than baseline** → tolerable
- **Cold-start ≥ 5 s slower** → contention bad enough to need
  scheduling

## Caveats

- Same source content for all cells (test simplification per 15).
- M=8 / 4 split chosen to fit within K=16's known-clean upload
  budget (per 24f-h: K=16 at 270p = clean 60 fps).
- Cold-start spawns 4 fresh workers per pass; warmup cost included.
- No camera capture (24h already validated capture + bitmap).
- The 4 cold-warming cells aren't rendered — only the 8 warm cells
  paint. (Once cold-start finishes the cells would in principle
  become available for render, but that's a real-app concern; this
  experiment focuses on contention.)
- 15 s run; cold-start typically finishes around T+5-6 s, so the
  remaining 9-10 s captures the post-cold-start steady state.

## Reproduce

```sh
git checkout <result.json git.sha>
pnpm dev
TIMEOUT_MS=300000 PORT=<port> experiments/harness/run.sh 28_warm-cold-mixed
```
