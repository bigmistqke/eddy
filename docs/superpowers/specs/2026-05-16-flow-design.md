# eddy flow design

**Date:** 2026-05-16
**Status:** approved design, not yet implemented
**Builds on:**
- `docs/superpowers/specs/2026-05-11-eddy-mvp-design.md` (concept, composition, transport)
- `docs/superpowers/specs/2026-05-14-video-playback-scaling-design.md` (composite vs streaming)
- Experiments 04-14 (composite, streaming, sub-atlas rebuild, bitmap series, cold-start, atlas swap)

## What this spec covers

The shape of a recording session as the user experiences it: opening
the app, starting the first take, committing one take after another,
re-recording, listening to the loop. Defines the cell state machine,
the rendering contract, the loop-boundary synchronisation point, and
the two background builders that keep the loop smooth.

What it does NOT cover: the WebGL renderer's draw code, the OPFS
on-disk layout in detail, layout-edit interaction with rebuild
priority, export (deferred to v2 per the MVP spec).

## Core decision: the app is the loop

The loop is the app's resting state. Once anything plays-able exists
— even just the empty grid with the camera live — the loop is
running. Recording is a state a *cell* enters, never a mode the
*app* enters.

There are only two transport states:

- `stopped` — no playback, clips retained, atlases retained.
- `looping` — the loop is running, cells render according to their
  per-cell state.

The user goes `stopped → looping` by starting the first take or
hitting Play; `looping → stopped` only via an explicit Stop
affordance. Everything else happens *inside* `looping`.

## Cell state machine

Each cell is in exactly one of six states at any time:

```
empty              black, selectable
live-preview       camera in this cell (selected-empty)
queued              live-preview + visual pulse on loop position
recording          live-preview + MediaRecorder writing the new clip
playing-bitmaps    bitmap series @ 30fps, no decoder used
playing-atlas      sub-atlas decoder paints this cell at its tile rect
```

The intermediate `pending-bitmaps` state from the brainstorm is gone:
bitmaps are generated *during* recording (12b), so the series is
complete the moment recording stops. There is no gap.

Cell transitions:

```
empty → queued (via tap on the cell)
empty → live-preview (via selection)
live-preview → queued (via tap record)
queued → recording (at next loop boundary 0)
recording → playing-bitmaps (at next loop boundary 0 after auto-stop)
playing-bitmaps → playing-atlas (at next loop boundary 0 after sub-atlas rebuild lands)
playing-atlas → queued (re-record: drops clip when queued, atlas becomes
                       stale; cell goes silent + live-preview)
any → empty (via delete)
```

**All state changes happen at loop boundary 0** — never mid-loop.
This is the one sync point in the system. Renderer transitions are
visually atomic; audio re-schedules at the same instant.

## Per-frame rendering

Each frame, the renderer asks every cell one question: "what should I
paint right now?" The answer is determined by cell state:

| state | source |
|---|---|
| `empty` | black |
| `live-preview` / `queued` / `recording` | the persistent preview `<video>` element |
| `playing-bitmaps` | `bitmaps[ floor((position - cellStartOffset) * 30) ]` |
| `playing-atlas` | the sub-atlas `VideoDecoder`'s current frame, sampled at the cell's sub-rect |

One `texImage2D` per cell per frame, drawn at the cell's frame rect
(from existing `layoutFrames`). At K=8 cells this is ~5ms per frame
total (12 baseline measurement).

## Loop boundary as the only synchronisation point

`Transport` emits `onLoopBoundary` at each cycle start. A queue of
pending cell-state transitions is drained at every boundary:

- `queued → recording`: MediaRecorder starts, AudioBufferSourceNode
  for the previous clip (if any) is dropped, bitmap pipeline (12b)
  starts capturing
- `recording → playing-bitmaps`: bitmap series is already complete
  (12b); new audio clip is scheduled into the loop on this boundary
- `playing-bitmaps → playing-atlas`: sub-atlas decoder takes over,
  bitmap memory freed; the held first VideoFrame (14) is rendered
  this frame, decoder continues for subsequent frames

The contract: the user stops recording → on the very next loop pass,
they hear the take AND see it (low-res via bitmaps). The atlas swap
settles silently over the next minute. Sample-accurate audio sync;
visually atomic video transitions.

## Two background builders

When a cell changes (new take, re-record, layout edit affecting its
container), two Workers start in parallel, both decoding the same raw
source clips from OPFS:

### Builder A — bitmap-series

Runs **during** recording via `MediaStreamTrackProcessor` + Worker
(12b). Reads `VideoFrame`s from the camera, downscales to a small
canvas (~96×174), emits `ImageBitmap` per frame, transferred back to
main thread. 100% keep-up at 30fps, mean latency 3.6ms. Series is
complete at recording-stop with no post-processing.

For non-recording dirty-state cases (layout edits, cold-start into a
dirty atlas), runs **after** the fact — decodes the clip from OPFS,
emits bitmaps. ~0.34× realtime cost (12), so a 30s clip → ~10s
build. The cell shows the last known frame (or a static placeholder)
during this gap.

### Builder B — sub-atlas (container-aligned)

Per-leaf-container in the layout tree (11), not a fixed K. When any
cell in container `c` changes, container `c`'s sub-atlas is
re-encoded from the raw clips of all cells in `c`. Always rebuilt
from raw — no generation loss accumulates.

Cost: ~1.18× realtime under contention with capture + atlas decode +
bitmap paint (10/11 at CSS-pixel resolution, 540×983 atlas). For a
30s song, a single sub-atlas rebuild is ~36s wall-clock. Fits inside
the recording window of the next take with margin.

Both Workers process FIFO, one job at a time per builder. If the
user records 4 takes back-to-back, the queue serializes them; the
cells all visibly succeed via bitmaps, only the final atlas swaps lag.

### No generation accumulation

Every sub-atlas cell is always at exactly **1 VP8 generation** from
raw camera output. Every bitmap is **1 generation** (decoded then
rasterised; the raster is final). Compositing happens at WebGL draw
time, never at the encoder. Recording 100 takes never compounds.

## Atlas persistence + cold start

Sub-atlases are persisted to OPFS as encoded `.webm`-equivalent blobs.
Manifest carries a per-container `sourceHash` (hash of the set of
cell-clips that produced the atlas). On any state change affecting a
container, recompute the hash; mismatch = atlas dirty.

Cold-start path:

```
boot → read layout from OPFS
     → read atlas manifest
     → for each leaf container:
         fresh? → start atlas decoder → cell in playing-atlas
         dirty? → enqueue Builder A + Builder B → cell starts in
                  live-preview frame (or last-known) → playing-bitmaps
                  → playing-atlas
     → enter looping
```

Measured cold-start latency for clean atlases (13): single 219ms,
K=4 parallel 561ms. App opens into the loop in well under 1s.

Bitmaps are session-only — cheap enough to regenerate on demand, not
worth the OPFS write-and-keep-fresh cost on every take.

## Atlas swap pattern

When Builder B completes a sub-atlas rebuild, the cells in that
container don't swap immediately — that would interrupt the current
loop pass. Instead:

1. The new atlas is persisted to OPFS.
2. A new `VideoDecoder` is created, configured, fed its first chunk.
   The resulting `VideoFrame` is drawn to a small canvas and
   converted to an `ImageBitmap` (the frame itself is closed).
3. The cell sits in a "pre-warmed" sub-state, still painting from
   bitmaps or the old atlas. The held `ImageBitmap` plus the still-
   open `VideoDecoder` wait for the boundary.
4. At the next loop boundary, the cell's source pointer flips. The
   held `ImageBitmap` paints this frame; the decoder feeds subsequent
   delta chunks (state retained across the idle).

Validated by 14 (0 ms hot swap) and 16 (`ImageBitmap` hold + decoder
state both survive 30 s; post-idle delta decode 12-34 ms). The
**ImageBitmap-hold** form is the production pattern — 14's original
`VideoFrame`-hold version worked at 500 ms but `VideoFrame` lifetime
across longer holds is opaque.

Production timing: kick off `decode(chunk 1)` a few ms *before* the
boundary so frame 1 doesn't race the 33 ms tick budget after the
swap (per 16's note).

## Where the architecture sits in the design space

| dimension | choice | why |
|---|---|---|
| Playback representation for K ≤ 4 | direct VP8 stream per cell, no atlas | smooth 60fps through K=3, K=4 hitches slightly (18d) — simplest path |
| Playback representation for K > 4 | sub-atlas (container-aligned) | streaming walls at K≥5 (18d); atlas is O(1) per-container decode, layout-aware cache boundary (10/11) |
| Granularity | one per leaf container | matches user editing scope; K dynamic per layout |
| **When rebuilt** | **at any time, chunked** | chunked builds (18e/18f) have baseline jank vs mono's score 150+; can rebuild during recording without contention |
| **How rebuilt** | **temporal chunks (~1-2 s each) with `setTimeout(0)` yields between** | 18e: chunked = baseline jank, mono = visible hitches; chunked also ~25% faster total |
| Rebuilt from what | raw OPFS clips | no generation loss (per `video-playback-scaling.md` requirement) |
| Atlas resolution | CSS-pixel (~540×983) | sweet spot per 10's sweep: sharp at standard density, contention-free |
| Gap during rebuild | bitmap series (OPFS-backed) | sidesteps decoder budget (12), generated during record (12b), OPFS-backed to avoid OOM (18c) |
| **Bitmap storage** | **OPFS raw RGBA per cell** | 18c: in-memory OOMed at 575 MB; OPFS keeps it at 10 MB peak |
| Cold start | persisted atlas + sourceHash | under 1s open into loop (13) |
| Atlas handoff | pre-warmed decoder + held ImageBitmap | 0ms swap, survives 30s (14/16) |
| **Per-frame contract** | **`gl.clear` at start of every rAF tick** | 18c: without it Android Chrome silently fails to present cells whose textures weren't most-recently-uploaded |
| **Decoder pacing** | **driven from rAF tick (single clock source)** | 17b: flat-out continuous decoders starve rAF; pacing recovers smoothness |
| **Smoothness metric** | **`framesOver33ms` + `longestJankStreak` + `jankScore`** | 18d/jank.ts: mean fps lies when distribution is bimodal — `framesOver33msRatio` is what the user perceives |

## Validation summary

| Claim | Backed by |
|---|---|
| Composite is O(1) in N, beats streaming past N=4 | 04, 05 |
| Hardware decode-bound; workers don't add throughput | 06 |
| Composite pipeline is worker-safe | 07 |
| Atlas build ~1.2× realtime, linear; chunking mandatory for memory | 08 |
| Build-during-recording (mono) fails: 1.2× → 2.5× under contention; capture drops | 09 |
| K=4 sub-atlases at CSS-pixel res is the sweet spot | 10 |
| Container-aligned sub-atlases hold to K=8, get *better* with K | 11 |
| Bitmap-series gap-filler works (K≤4 safe) | 12 |
| Bitmaps can be generated during recording at 100% keep-up via MediaStreamTrackProcessor | 12b |
| Cold-start from OPFS is under 1s (single 219ms, K=4 561ms) | 13 |
| Atlas swap at loop boundary is 0ms with pre-warmed decoder + held ImageBitmap | 14, 16 |
| Distinct content barely affects atlas cost (+4% bytes, -5% fps) | 15 |
| Steady-state render is 60fps; contended is 22fps (rAF throttle); driving decoders from rAF avoids starvation | 17, 17b |
| Mono atlas linear-N rebuild cost (0.2× per cell added); needs container-aligned sub-atlases at scale | 18 |
| In-memory bitmap series OOMs the tab at ~575 MB on full progressive | 18b |
| OPFS-backed raw RGBA bitmaps cap memory at ~10 MB; `gl.clear` per frame is mandatory | 18c |
| Pure streaming smooth K≤3-4; janky at K≥5 (decoder hardware contention) | 18d |
| Chunked atlas builds (~1-2 s per chunk, `setTimeout(0)` yields) eliminate rebuild-during-record contention | 18e |
| Chunked builds hold smoothness across 9-stage progressive flow (build/record fps stays 58-60) | 18f |
| Standardized jank metrics: `framesOver33ms`, `longestJankStreak`, `jankScore` reveal what mean fps hides | harness/jank.ts |

## Not yet validated / explicitly deferred

- **Audio integration with the rebuild queue.** Audio is already
  scheduled via existing `transport.ts`; the boundary contract is
  defined. Implementation will surface any gotchas. *No experiment
  yet.*
- **Layout edits with rebuild in flight.** A user splits cell X
  while a different sub-atlas is rebuilding. With chunked builds
  (18e/18f), this is much less concerning: cancel the in-flight
  chunk worker on layout change, start a fresh chunked build for
  the new container set. The "cancel-and-replace" mechanism is
  still ours to wire up.
- **Audio + video sync across loop boundaries.** The boundary
  contract is defined (Section 3), but no experiment has measured
  the actual sync error between the audio scheduler and the
  visual handoff. Worth a small spike before src/.
- **Multi-session realism.** All experiments are ~1-2 min sessions
  on a freshly-loaded tab. Long-session (10+ min) thermal /
  memory / GPU-state behaviour is unmeasured. Add a soak test
  before declaring the design production-ready.

## Notable production lessons (surfaced post-design, all in
`experiments/NN_*/README.md` Note-for-eddy-implementation sections)

- `gl.clear` at start of every rAF tick is **mandatory** on Android
  Chrome (18c). Without it, cells whose textures aren't the most-
  recently-uploaded silently fail to present.
- Decoder feed is driven from the rAF tick — **single clock source,
  no `setInterval`** (17b).
- Atlas builds are chunked (~1-2 s each) with `setTimeout(0)`
  yields between (18e/18f). Mono builds visibly hitch.
- Bitmap series is stored as raw RGBA in OPFS via
  `FileSystemSyncAccessHandle`, read by a worker, uploaded direct
  to texture via `texImage2D` (no `ImageBitmap` intermediate; 18c).
- Atlas swap uses ImageBitmap-hold + open decoder, not VideoFrame-
  hold (14/16).
- Perceived smoothness is measured via `framesOver33msRatio` +
  `longestJankStreak` + `jankScore` (harness/jank.ts), not mean
  fps. Mean lies on bimodal distributions.

## Next step

The architectural questions have evidence behind them. Remaining
open items are smaller (audio sync, layout-edit cancel-replace,
soak). `src/` work can begin, scoped tightly to the validated
pieces.

Suggested order for src/ work:
1. `harness/jank.ts` → port to `src/utils/jank.ts` for the
   production renderer's frame-time telemetry
2. Renderer baseline (one cell, atlas decode, `gl.clear` + rAF +
   `texImage2D` per the validated patterns)
3. Chunked atlas builder (18e/f's pattern, productionised)
4. OPFS bitmap-writer + reader (18c's pattern)
5. Per-cell state machine + loop-boundary scheduler
6. Container-aligned sub-atlas wiring

Per-piece, write a small Playwright test that mirrors what its
originating experiment measured, so regressions surface.
