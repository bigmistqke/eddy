# decoder-pool-multi

**Question:** can N decoders, each time-slicing across cells_per_decoder
cells, sustain K cells past the streaming wall (K=4 per 04) and the
single-decoder ceiling (~2-3 cells per decoder, per 19)?

## Why

[19](../19_decoder-pool-time-slice/README.md) validated:
- Pure switch cost is **~77 ms** (matches 01)
- Per-decoder throughput at 720p is **~44-90 fps** under sustained
  load (varies more than expected)
- **1 decoder ≈ 1.4-2.5 cells** at realtime depending on per-chunk
  decode cost

For K > ~2 cells, one decoder isn't enough. The natural next move:
**pool of N decoders**, each handling some subset of cells. Per
04/06, 4 concurrent decoders sustain ~140 fps aggregate. Spread
across cells:
- N=4 decoders × 2 cells each = **K=8** supported
- N=4 × 3 cells each = K=12 if per-decoder ceiling is generous

This experiment validates the multi-decoder pool architecture in
the same setup as 19 (per-cell sources, real switch costs, source-fps
paced renderer).

## Setup

Three passes:
- **N=2 decoders, K=4 cells** (2 cells per decoder — comfortable)
- **N=4 decoders, K=8 cells** (2 cells per decoder at max scale)
- **N=4 decoders, K=12 cells** (3 cells per decoder — stretch)

Per pass:
1. Record K source clips upfront (each cell has its own source).
2. Spawn N decoders. Round-robin assign: cell[i] → decoder[i % N].
3. Each decoder runs its own scheduler loop (independent of other
   decoders), time-slicing across its assigned cells using 19's
   priority-pick pattern.
4. Shared renderer paints K cells, source-fps paced (per 19's fix).

## What's measured

Per pass:
- Per-decoder: switches, batches, mean pureSwitchMs / batchMs, effective fps
- Per-cell: framesPainted, underflows, renderFps
- Total: aggregate decoder fps, totalUnderflows, render jank

Pool scaling test:
- N=2/K=4: should match 19's K=2 case per decoder (1 decoder=2 cells)
- N=4/K=8: production target — same per-decoder load, just more
  decoders running concurrently
- N=4/K=12: stretches per-decoder cells; reveals where it falls over

## What to look for

- **N=2/K=4 ≈ 19's K=2 result × 2** (independent decoders shouldn't
  interfere much)
- **N=4/K=8 holds at low underflow** → the production goal works
- **N=4/K=12 starts to fail** → marks the realistic ceiling
- **Aggregate decoder fps scales** with N (per 06's hardware-decode-
  bound finding, scaling is sub-linear; 4 decoders ≈ 1.66× one
  decoder per 02)

## Verdict

**Aggregate caps near ~165 fps regardless of N.**
- N=2/K=4 → 88 fps aggregate, 213 underflows
- N=4/K=8 → 166 fps aggregate, 419 underflows
- N=4/K=12 → 154 fps aggregate, **1516 underflows (collapses)**

Adding decoders past N≈4 doesn't add bandwidth — same ceiling 02/04/06 hit. Per-cell starves as K grows. Atlas grouping still required past K≈4 (for VP8 specifically — see 20).

## Caveats

- Source clips recorded back-to-back; configs match. A real session
  may have varied configs.
- v1 uses static round-robin assignment. Dynamic load-balancing
  (move a cell to a less-busy decoder) is a follow-up.
- Tests assume cells need source-fps frames. If a cell loops at
  half-rate or has dropped frames, the math changes.

## Reproduce

```sh
git checkout <result.json git.sha>
pnpm dev
TIMEOUT_MS=600000 PORT=<port> experiments/harness/run.sh 19b_decoder-pool-multi
```
