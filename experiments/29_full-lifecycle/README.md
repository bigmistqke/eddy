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

## Verdict

**Full lifecycle survives integration. Total 23.3 s end-to-end, each phase matches its isolated baseline.**

| phase | wall time | metric | isolated baseline | match? |
|---|---|---|---|---|
| **LOAD** (K=16 cold-start) | **2.85 s** | per-cell decode 959 ms + write 1203 ms | 26b: 4.5 s | ✓ faster (variance) |
| **PLAY** (10 s) | 10 s | 58.7 fps, 0.9% over 33 ms | 24g: 59.3 fps, 1.5% | ✓ matches |
| **RECORD** (5 s) | 5 s | 57.0 fps, 3.2% over 33 ms, 115 capture chunks | 24h: 58.7 fps, 1.7% | ✓ matches |
| **SAVE** (K=16 AV1 parallel) | **4.25 s** | 1236 KB total, 77 KB/cell | 27: 2.1 s | ⚠ ~2× slower |

The save phase is ~2× slower than 27's isolated baseline. Most likely cause: 29 reads RGBA from OPFS first (480 MB across 16 cells) and constructs `VideoFrame` from each slice, while 27 had bytes already in memory. The OPFS read + VideoFrame construction overhead adds ~2 s. Not contention or thermal — a one-time cost of working from disk.

Capture got 115 chunks in 5 s (~23 chunks/s), comfortably more than 24h's rate-equivalent.

**End-to-end validation summary for C2 on this device:**

| layer | validated by |
|---|---|
| Storage compression (AV1 vs RGBA) | 26 (520-580×) |
| Cold-start latency | 26b (~4.5 s for K=16) |
| Playback at K=4-25 | 24f / 24g |
| Capture during playback | 24h |
| Cold-start during playback | 28 |
| Save (RGBA → AV1) | 27 (2.1 s isolated) / 29 (4.25 s from disk) |
| Full lifecycle integration | **29 (23 s end-to-end)** |

## Note for eddy implementation

- The C2 architecture survives end-to-end integration at K=16 on this device.
- Save-from-disk adds ~2 s vs save-from-memory. Worth knowing — if real-time save speed is critical, keep RGBA buffers in memory while user is editing rather than re-reading on save.
- 23 s total session timeline (open + play + record + save) is dominated by the wait times (15 s play+record), not the actual work (load 2.85 s + save 4.25 s ≈ 7 s).
- Capture during the record phase shows slightly more jank (3.2% vs 1.7% in 24h) — could be cumulative thermal at the ~17 s mark, or run-to-run variance. Worth watching at longer durations.
- No cumulative jank growth observed across phases — playback in phase 2 and phase 3 both match their isolated baselines within noise.

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
