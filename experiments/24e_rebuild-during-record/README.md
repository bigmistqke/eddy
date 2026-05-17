# rebuild-during-record

**Question:** in the refined eventually-consistent design (camera +
~4 recent cells as streams + everything else in atlases, rebuild
deferred to idle time / multi-recording windows), the single
load-bearing moment is: **one atlas rebuild running concurrent with
one active camera capture and ongoing atlas playback**. Does that
moment survive on this device with AV1 throughout?

## Why

[24c](../24c_incremental-rebuild/README.md) and
[24d](../24d_worker-rebuild/README.md) showed rebuild-on-every-edit
doesn't work — rebuilds take 9-20 s under playback contention and the
contention itself janks rAF. But that scaffold assumed *frequent*
rebuilds. The refined design relaxes that to one rebuild per ~4
recordings (a deferred batch), giving rebuilds 25-40 s of effective
budget. So per-rebuild *latency* is no longer the constraint.

The remaining question is whether that one rebuild — concurrent with
camera capture (the camera was the trigger to begin with) and atlas
playback for the other K-1 cells — produces watchable output.
[18g](../18g_progressive-overlap-chunked/README.md) proved this for
VP8 (capture + chunked build + atlas playback at K≤9, all VP8, all
smooth). AV1 may be more expensive end-to-end and K=16 is heavier
than K=9. So this is a direct AV1 K=16 port of 18g's load profile,
sliced into 4 attribution passes.

## Setup

Steady-state world: **K=16 cells in M=2 atlases × 8 cells each at
270p mip** (atlas size 960×1088 — close to 18g's container-aligned
mid-K case, scaled to AV1).

Each pass runs ~15 s. Same source recording, same per-cell mip.

| Pass | Atlas playback | Concurrent camera capture | Concurrent rebuild |
|---|---|---|---|
| 1 baseline | yes | no | no |
| 2 capture-only | yes | yes (10 s) | no |
| 3 rebuild-only | yes | no | yes (1 atlas, ≤10 s budget) |
| 4 full | yes | yes (10 s) | yes (1 atlas) |

The 4-pass shape lets us attribute jank: pass 2 isolates capture
cost, pass 3 isolates rebuild cost, pass 4 is the combined hot path.
Comparing 4 - 2 - 3 against baseline reveals super-linear contention
(if any).

Camera capture uses `recordProbeInput` (MediaRecorder + demux, the
existing harness path). Rebuild uses 24d's `rebuild-worker.ts` (one
shot at T+2s, building a 4-cell AV1 atlas at 270p — i.e., the kind of
atlas that would represent ~4 freshly-recorded cells being packed
together).

## What's measured

Per pass (mirrors 24c/24d for direct comparison):
- Render fps + standard JankRecorder stats
- Long-tasks observed
- Aggregate decode fps (atlas decoders only here; per-cell stream
  count is fixed at 0 — no "dirty" cells in this experiment)
- For passes 3/4: rebuild wall-time under this specific contention
- For passes 2/4: capture wall-time + whether it completed cleanly
  (every captured frame accounted for)

## What to look for

- **Pass 1 ≈ 60 fps, <1% over 33ms** — sanity, matches 24a K16-M4
- **Pass 2 (capture-only) stays close to baseline** — capture is a
  background cost the GPU process absorbs (18g says yes for VP8)
- **Pass 3 (rebuild-only) ≈ 24c/24d pattern at R=0.25** — single
  rebuild, ~9-15 s wall time, render jank during the rebuild window
- **Pass 4 (full) ≈ pass 3 jank, OR super-linear worse** — if
  super-linear, the refined design has a real problem at this device
- **Rebuild wall-time in pass 4 vs pass 3** — does adding capture
  slow the rebuild further?

## Verdict

**Capture + rebuild concurrent fails super-linearly. The "rebuild at record_start" trigger is the wrong moment.**

| pass | fps | mean | p95 | max | >33ms | streak | jankScore | rebuild | capture |
|---|---|---|---|---|---|---|---|---|---|
| baseline | 60.1 | 17.0 | 16.7 | 283* | 0.2% | 1 | 69 | — | — |
| capture-only | 57.0 | 17.6 | 16.8 | 80.5 | 4.8% | 5 | 5.6 | — | 193 chunks |
| rebuild-only | 46.6 | 21.5 | 50.0 | 166 | 12.2% | 45 | 183 | 10.7 s | — |
| **full** | **32.3** | 31.2 | 116.5 | 350 | **22.1%** | 13 | **2100** | 13.8 s | **119 chunks** |

\* baseline max 283 ms is one first-frame setup hitch; p95 16.7 confirms steady-state clean.

Three findings:

1. **Capture alone is cheap** — atlas playback survives concurrent VP8 camera capture easily (5% jank). Confirms 18g's VP8 finding for AV1 at K=16.
2. **Rebuild alone is moderate** — 12% jank during the rebuild window. Matches 24c/24d's known cost.
3. **Capture + rebuild is super-linear bad** — 22% jank, jankScore 11× rebuild-only's, and capture itself lost 38% of its frames (193 → 119 chunks for the same 10 s window). A partial recording is a UX failure, not just a perf one.

The refined design's underlying insight (rebuild can be deferred to idle time) is sound, but the proposed trigger — "rebuild at record_start" — is the worst moment to fire it. Recording is when capture can't afford to lose frames *and* when atlas playback can't afford to look janky to the recording user.

## Note for eddy implementation

- **Don't run rebuild concurrent with capture.** The capture's frame loss alone disqualifies this trigger.
- **Trigger at record_stop instead.** Rebuild only with atlas playback contention (12% jank for ~10 s), no capture overlap. That window is also a lower-attention moment (user reviewing the take), making the jank more forgivable than during creation.
- **The "start next recording within rebuild window" case** is the new edge case: if rebuild is mid-flight when the user hits record again, we're back to the super-linear failure. Possible mitigations: block record-start UI until rebuild done (latency hit), cancel rebuild and defer (D grows), or accept the contention (probably too bad).
- **Capture frame loss under contention is a previously-unmeasured cost.** Should be checked anytime a feature might run concurrent with active recording.

## Caveats

- Single rebuild fires at T+2 s. Real flow may have multiple stacked.
- Capture uses MediaRecorder (VP8 output) — the encoded format that
  feeds into the system, regardless of what later transcoding does.
- Atlas size 960×1088 is bigger than 24c/24d's 960×544 (4 cells), so
  rebuild wall-time may be longer here even uncontended. Trade-off
  for matching the refined design's atlas geometry (more cells per
  atlas = lower upload count).
- No atlas-swap at rebuild completion (24a-style measurement only).
  Swap-hitch is 14/16's territory, not in scope here.
- K=16 cells, but the refined design also has 1 live camera cell.
  This experiment renders only K=16 from atlas; the camera frame
  data is captured but not rendered. That keeps the comparison
  numerically clean against 24a's K=16; in the real design the
  camera would add one more texture upload (M=2 + 1 camera = 3 well
  within budget).

## Reproduce

```sh
git checkout <result.json git.sha>
pnpm dev
TIMEOUT_MS=360000 PORT=<port> experiments/harness/run.sh 24e_rebuild-during-record
```
