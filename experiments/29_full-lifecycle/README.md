# full-lifecycle

**Question:** the C2 architecture's four phases have all been
measured in isolation (26b cold-start, 24h playback + capture, 27
session-save). **Does the full session lifecycle hold together
end-to-end at K=16 — load → play → record → save — in a single
continuous run?**

## Why

Each phase has been validated:
- Cold-start ([26b](../26b_cold-start-copyto-workers/README.md)): K=16 in ~4.5 s with copyTo + workers
- Steady-state playback ([24g](../24g_opfs-bitmap-render/README.md)): K=16 at 59 fps from OPFS bitmaps
- Concurrent capture ([24h](../24h_bitmap-during-record/README.md)): playback + capture = 96% frame retention
- Session-save ([27](../27_session-save-encode/README.md)): K=16 parallel AV1 encode in ~2.1 s

But each was tested independently. Running them as one continuous
session surfaces any cumulative thermal/resource issues, state-
transition glitches, or unexpected interactions that don't show up
in isolation. This experiment is the integration test for the C2
architecture.

## Setup

Single pass at K=16, 270p mip. Four phases run in sequence with no
device cool-down between:

| Phase | Operation | Wall-time target |
|---|---|---|
| 1 — load | Pre-stage K=16 AV1 files; spawn 16 copyTo+worker cold-start (per 26b) | ~5 s |
| 2 — play | Render K=16 cells from RGBA cache for 10 s | 10 s |
| 3 — record | Continue render + start 5 s camera capture | 5 s |
| 4 — save | Encode K=16 RGBA back to AV1 in parallel (per 27) | ~2 s |

Total: ~22 s wall time.

Setup phase (before timing starts): record VP8 source, transcode to
AV1 at 270p, write K=16 AV1 files to OPFS.

## What's measured

Per phase:
- `loadMs` — cold-start wall time, plus per-cell breakdown
- `playJank` — JankRecorder stats for the 10 s playback phase
- `recordJank` — JankRecorder stats for the 5 s record-while-playback phase
- `recordCaptureChunks` — capture chunks retained
- `saveMs` — total wall time for K=16 parallel AV1 encode
- `saveBytesPerCell`, `saveTotalKb` — output AV1 size

Aggregate:
- Total wall time
- Long-tasks observed across the whole run
- Empty-cell ticks during play/record (sanity)

## What to look for

- **All four phases match their isolated baselines** within run-to-run noise — confirms no cumulative issue
- **Record phase capture-retention ≈ 96%** (24h baseline) — confirms incremental load doesn't damage capture later
- **Save phase ≈ 27's K=16 AV1 parallel ~2.1 s** — confirms thermal at end-of-session doesn't tank encode
- **Cumulative jank** during play+record at the end of the session is similar to early-session jank — no thermal drift
- **No long-tasks during play phase** — playback stays clean even after the cold-start did codec work

## Caveats

- Single source clip across all cells (test simplification per 15).
- All 16 cells warm in parallel; real eddy might warm visible-first.
- Camera capture runs concurrent with playback for 5 s; the captured chunks are discarded (not encoded into the save phase).
- The save phase re-encodes the SAME pre-warmed RGBA cells (no actual content change). Real eddy save would only re-encode modified cells.
- No backlog scenarios (back-to-back record, multiple saves) — those are separate questions.
- 22 s total wall time isn't long enough to surface deep thermal — a 60+ s sustained test would, but isn't C2-specific.

## Reproduce

```sh
git checkout <result.json git.sha>
pnpm dev
TIMEOUT_MS=240000 PORT=<port> experiments/harness/run.sh 29_full-lifecycle
```
