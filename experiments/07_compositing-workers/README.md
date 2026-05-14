# compositing-workers

**Question:** can the composite pipeline — atlas **build** *and* atlas
**decode** — run entirely off the main thread?

## Why

[05_compositing-full-video](../05_compositing-full-video/README.md)
showed the composite wins on throughput, but the atlas **build** takes
~9–13 s. On the main thread that would freeze the UI for that whole
window — unacceptable in a live jam tool.

[06_grid-streaming-workers](../06_grid-streaming-workers/README.md)
already showed Workers don't change decode *throughput* (it's
hardware-bound). So this is **not** a speed experiment — it's a
**feasibility check**: run the whole composite pipeline inside a Worker
and confirm it (a) works and (b) produces the same numbers as 05. If so,
the real app can rebuild atlases in the background with its main thread
free for rendering.

## Setup

Identical grids to 05 (4, 9, 16, 25) at viewport-res atlas. The only
difference: `composite-worker.ts` runs `harness/composite.ts` (build) +
the decode loop inside a Worker; the main thread only records the source
and posts it in. Reports per-grid `compositeMs`, `fps`, `realtimeOk` —
directly comparable to 05.

**Read it as:** numbers ≈ 05 → the composite pipeline is worker-safe,
and the build can be backgrounded. Numbers diverge or it errors → some
part of the pipeline (`OffscreenCanvas`, `VideoEncoder`, `VideoDecoder`)
misbehaves in a Worker on this device.

## Verdict (2026-05-14 · Galaxy A15 · Android 10 · Chrome 148)

**Feasibility confirmed — the composite pipeline is worker-safe.**
Build + decode both run inside a Worker; numbers track 05:

| N | worker fps / build | 05 main fps / build |
|---|---|---|
| 4 | 87.7 / 18.7 s | 89.3 / 8.8 s |
| 9 | 81.3 / 12.7 s | 78.3 / 12.0 s |
| 16 | 80.3 / 12.8 s | 110.3 / 10.3 s |
| 25 | 107.6 / 13.9 s | 98.4 / 12.7 s |

- **Decode fps:** worker ≈ main, within run-to-run noise (both bounce
  78–110) — consistent with 06: Workers don't change decode throughput.
- **Build time:** ~12–14 s, ≈ 05. Workers don't speed the build either
  (same hardware). N=4's 18.7 s is an outlier — likely first-worker
  cold-start (module load + codec init).
- `OffscreenCanvas`, `VideoEncoder`, `VideoDecoder` all work in a Worker
  on this device — no fallbacks needed.

**Takeaway:** the ~10–15 s atlas build can't be made *faster* by
threading, but it **can be moved off the main thread** — so the real app
rebuilds atlases in the background with its UI thread free. Combined
with 05, the composite is both the fastest *and* the most
UI-friendly option.

## Reproduce

```sh
git checkout <result.json git.sha>
pnpm dev
PORT=<port> experiments/harness/run.sh 07_compositing-workers
```
