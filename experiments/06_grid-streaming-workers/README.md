# grid-streaming-workers

**Question:** is streaming's poor scaling (03/04) partly **main-thread
contention** rather than pure hardware decode bandwidth?

## Why

[04_grid-streaming-transcoded](../04_grid-streaming-transcoded/README.md)
ran all N `VideoDecoder`s on the main thread — N decoders, N output
callbacks, N backpressure-polling loops, all sharing one event loop.
Some of the sub-linear scaling could be that contention, not the decode
hardware itself.

This is 04 with **one decoder per Web Worker** — zero main-thread decode
contention. Same transcode step, same grids (4, 9, 16, 25), same
metrics. Only the threading differs.

## Setup

Identical to 04 — record once, transcode per grid to cell size — except
each cell's decoder runs in its own `decode-worker.ts`. The worker loops
the transcoded clip flat-out for `runSeconds` and posts back its frame
count. Reports per-decoder fps, min, aggregate, `realtimeOk`.

**Read it as:** compare `minFps` / `aggregateFps` against 04 at the same
N.

- If they improve materially → main-thread contention was a real factor;
  a streaming architecture should use workers.
- If they don't → streaming is genuinely hardware-decode-bound, workers
  don't help, and 05's composite advantage stands unchallenged.

## Verdict (2026-05-14 · Galaxy A15 · Android 10 · Chrome 148)

**Workers don't help — the contention hypothesis is falsified.** One
decoder per Worker vs 04's all-on-main-thread:

| N | workers min / agg | 04 main min / agg |
|---|---|---|
| 4 | 33.5 / 142 | 31.8 / 136 |
| 9 | 22.4 / 224 | 20.6 / 204 |
| 16 | 13.6 / 276 | 14.2 / 276 |
| 25 | 10.5 / 331 | 10.7 / 361 |

The numbers match within run-to-run noise (±10–20%, established in
01_raw-capability) — no consistent direction, no material gain.

**Streaming's sub-linear scaling is genuinely hardware-decode-bound, not
main-thread event-loop contention.** The GPU's video decode units are
the shared resource; which thread issued the `decode()` call doesn't
change how fast they chew through it. Moving decoders off the main
thread is good practice for *jank* (keeps the UI responsive), but it
does **not** raise decode throughput.

Workers were the last plausible lever to rescue streaming. They don't.
05's composite advantage stands unchallenged.

## Reproduce

```sh
git checkout <result.json git.sha>
pnpm dev
PORT=<port> experiments/harness/run.sh 06_grid-streaming-workers
```
