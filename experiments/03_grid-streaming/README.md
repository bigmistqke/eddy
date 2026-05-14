# grid-streaming

**Question:** does the *real* streaming workload sustain realtime? — N
cells that together fill one ~viewport-sized image (each cell ≈
viewport/N), all decoded concurrently.

## Why

[decoder-pools](../decoder-pools/README.md) ran K decoders each on a
full 720p stream and found sub-linear scaling — but that's not the
product's workload. The real grid is **one ~viewport image subdivided
into N cells**: each cell is ~viewport/√N per axis, and total decoded
pixels stay roughly constant as N grows.

That isolates the question decoder-pools left open:

- If the bottleneck is **per-stream overhead** (a fixed cost per decoder
  instance), N small streams are still bad → the composite (one decode)
  wins.
- If it's **pixel bandwidth** (∝ total pixels), N small streams summing
  to a viewport are fine → streaming works, and the composite is
  unnecessary.

## Setup

`totalResolution` = the A15's screen (~1080×1965 device px). For each N
in `gridSizes` (4, 9, 16, 25 — square grids), records a clip at the cell
size (`total / √N` per axis), runs N decoders looping it concurrently
for `runSeconds`, and reports per-decoder sustained fps, the min, the
aggregate, and whether the slowest held `realtimeFps` (28).

**Read it as:** if `minFps` stays ≥ ~30 as N grows, streaming an N-cell
grid is bandwidth-bound and viable. If it falls off well before the
pixel budget says it should, per-stream overhead is the wall.

To vary, edit `params` in `index.ts` and commit.

## Verdict

_Pending first device run._

## Reproduce

```sh
git checkout <result.json git.sha>
pnpm dev
PORT=<port> experiments/harness/run.sh 03_grid-streaming
```
