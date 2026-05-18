# C2 Prototype — Phase 3 Design

**Date:** 2026-05-18
**Status:** active — rewritten 2026-05-18 against experiments 30 / 30b / 30c / 30d / 30f / 30g / 31
**Related:** [phase 2 design](2026-05-18-c2-phase2-design.md), [phase 1 design](2026-05-17-c2-phase1-design.md), [video pipeline experiments review](2026-05-17-video-pipeline-experiments-review.md)

> **Status note (2026-05-18):** the original draft of this spec proposed AV1-only transcode at record-stop. The 30-series experiments produced a different, better architecture: **dual capture-time encode** (720p canonical + 270p mip), each WebM self-contained with opus audio, decoders reading the 270p mip in workers. This spec replaces the draft.

## Scope

Third slice of the C2 architecture port. Two changes:

1. **Replace MediaRecorder capture with a dual capture-time encode pipeline**: `MediaStreamTrackProcessor` → branch into (a) 720p canonical AV1 encode + (b) WebGL-resized 270p mip AV1 encode + (c) opus audio captured once, muxed into both. Each clip produces two self-contained WebM files.
2. **Persist `clipId` in the project manifest** so the RGBA working cache (from phase 2) can survive across sessions; project reopen drops cold-start decode.

After phase 3:
- Recording finishes within ~150 ms of record-stop (was several seconds via post-transcode in the original draft).
- Canonical 720p AV1 storage enables fullscreen single-cell preview and future export at camera-native quality.
- Cell playback reads the 270p mip — much smaller decode workload — leaving SoC headroom for K=9 record-while-playing.
- Session reopen for previously-loaded projects drops from ~5 s (phase 2 cold start) to ~100 ms (manifest-driven cache reuse).
- Persistent storage per 9-cell session drops from ~25-50 MB (phase 2 WebM blobs) to ~10-20 MB (720p AV1 + 270p mip + audio in each).

## Evidence anchoring

The architecture is derived from these experiments. Numbers are A15 Galaxy (the floor device); mid/high-end Android should have more headroom.

| Experiment | Finding | Architecture impact |
|---|---|---|
| [30](../../../experiments/30_capture-time-av1-encode/README.md) | Capture-time AV1 pipeline works end-to-end | Replaces the original record-stop transcode |
| [30d](../../../experiments/30d_synthetic-30fps-stress/README.md) | AV1 SW encoder has 7-12× headroom at all mips up to 720p in isolation | 720p encode is realistic at capture time |
| [30b](../../../experiments/30b_capture-encode-under-playback/README.md) | Single 720p encode under K=9 720p decoders saturates the SoC; 270p decoders are fine | Must split: canonical 720p + smaller playback mip |
| [30f](../../../experiments/30f_capture-encode-decoders-in-workers/README.md) | Workers free the tick loop but don't fix CPU bandwidth contention | Decoder threading helps but isn't sufficient by itself |
| [30g](../../../experiments/30g_dual-encode-720p-and-270p/README.md) | Dual 720p + 270p encode under K=9 270p decoders runs cleanly (30 fps, pendingMax=1) | This is the architecture |
| [31](../../../experiments/31_resize-shootout/README.md) | WebGL canvas-transfer resize is the fastest (~0.7-2.9 ms p50) and only sync-correct path; createImageBitmap is slower | Required resize technique |
| [30c](../../../experiments/30c_audio-split-pipeline/README.md) | Opus audio muxes into both outputs with 28 ms A/V drift over 10 s | Each WebM self-contained with audio |

## What stays the same

- `BitmapSource` interface (`latestFrame`, `seek`, `reset`, `close`) — fully transparent to consumers
- `BitmapFrame` shape (`bytes`, `width`, `height`)
- `ClipStore`, `Clip` interface (the `clipId` field added in phase 2 stays)
- `Transport`, audio scheduling, loop/volume routing
- `Preview` and live camera adapter (still in-memory, transient)
- Renderer (raw-RGBA-only)
- Per-clip reader worker (`src/media/bitmap-reader-worker.ts` — phase 2)
- `/rgba/<clipId>.bin` working cache layout (phase 2)
- `BitmapSource.close()` async cleanup chain (phase 2)
- All UI components, HUD, layout-builder, state

## What changes

### 1. Capture pipeline: MediaRecorder → dual capture-time encode

The recording path replaces `MediaRecorder` with a custom pipeline rooted at `MediaStreamTrackProcessor`. Per camera frame:

```
camera VideoFrame (720p)
  ├─ rebased timestamp → new VideoFrame → VideoSampleSource (720p AV1) → Output(WebM 720p+audio)
  └─ WebGL canvas-transfer resize to 270p → new VideoFrame
                                           → VideoSampleSource (270p AV1) → Output(WebM 270p+audio)
```

Audio is captured once from `getUserMedia({video, audio})`. The audio track is cloned twice; each clone feeds a `MediaStreamAudioTrackSource(opus, 96kbps)` on its respective `Output`.

**Key implementation constraints (from experiments):**
- **WebGL canvas-transfer (NOT canvas-wrap)** for the 720p→270p resize — `transferToImageBitmap` per call to avoid aliasing across in-flight VideoFrames when the encoder is fire-and-track. Per [[feedback-webgl-resize-aliasing]].
- **Rebase video timestamps to start at 0** before feeding either video encoder — otherwise audio (synced-zero) and video (camera system clock) end up on different origins and playback is desynced. Per [[feedback-av-timestamp-rebase]].
- **Fire-and-track encoder submission** — don't `await` each `videoSource.add(sample)` in the tick loop; let the source queue ≤ 1-2 deep and drain at record-stop. Verified at K=9 in [30g](../../../experiments/30g_dual-encode-720p-and-270p/README.md).

New file `src/media/capture.ts` exposes `startCapture(stream): CaptureSession` returning:

```ts
interface CaptureSession {
  stop(): Promise<{
    canonicalBlob: Blob  // 720p AV1 + opus WebM
    mipBlob: Blob        // 270p AV1 + opus WebM
    durationSec: number
    frameCount: number
  }>
  cancel(): Promise<void>
}
```

The session owns the camera track lifecycle, both `Output` instances, the WebGL resize rig, and the audio cloning. `stop()` drains both encoders, finalizes both outputs, and returns the blobs.

### 2. Storage layout: two files per clip

```
/projects/<id>/manifest.json
/projects/<id>/clips/<cellId>.720p.webm   (canonical: 720p AV1 + opus)
/projects/<id>/clips/<cellId>.270p.webm   (mip: 270p AV1 + opus)
```

Both files are independently playable. The 270p file is the input to the bitmap pipeline (decoded → RGBA cache); the 720p file is reserved for fullscreen preview, export, and future re-edit.

**Existing WebM-blob projects:** legacy `<cellId>.webm` files (single VP8 + opus per phase 1/2) continue to load via the existing demux path. On first load of a legacy clip, treat it as the 270p mip (its actual resolution may differ — mediabunny demuxer handles it codec-agnostically); no 720p canonical exists until re-record.

### 3. Manifest persists `clipId` and per-mip metadata

Per-cell record gains:

```ts
interface CellRecord {
  cellId: string
  clipId: string
  // Cache metadata for the 270p-mip-derived RGBA cache. The hot path
  // reads these from the manifest instead of demuxing the WebM.
  cacheWidth: number
  cacheHeight: number
  cacheFrames: number
  cacheSourceFps: number
}

interface ProjectManifest {
  // ... existing fields
  cells: CellRecord[]
}
```

Legacy manifests with `cellIds: string[]` migrate on first load: derive `cellIds` from existing field, generate fresh `clipId`s, and re-decode to populate cache metadata (one-time cost).

### 4. Cross-session RGBA cache reuse on load

Currently (phase 2): every project-load decodes each clip's WebM and writes a fresh `/rgba/<clipId>.bin` file.

Phase 3: `blobToClip` checks `rgbaCacheExists(clipId)`; if present, skip decode and spawn the reader worker directly with metadata from the manifest:

```ts
// In makeBitmapSource:
if (await rgbaCacheExists(clipId)) {
  // Hot path: reuse persistent cache from manifest metadata.
  return spawnReaderForCache(clipId, cellRecord.cacheWidth, cellRecord.cacheHeight,
                             cellRecord.cacheFrames, cellRecord.cacheSourceFps)
}
// Cold-start path: demux 270p WebM, decode to RGBA, write cache, spawn worker.
const mipBlob = await loadClipBlob(cellId, "270p")
return await coldStartFromMip(mipBlob, clipId)
```

### 5. Startup GC: manifest-driven, not blind wipe

Phase 2's startup `wipeRgbaCache()` deleted all rgba files because we couldn't distinguish valid from orphaned. With clipIds in the manifest we compute the expected set:

```ts
const expectedClipIds = new Set<string>()
for (const projectId of allProjects) {
  const manifest = await readManifest(projectId)
  for (const cell of manifest.cells ?? []) {
    expectedClipIds.add(cell.clipId)
  }
}
await garbageCollectRgbaCache(expectedClipIds)
```

This preserves the cache for clips referenced by any project's manifest, deletes truly orphaned files (crash residue, deleted projects).

### 6. `deleteProject` reads manifest, deletes both WebMs + rgba cache per cell

```ts
async function deleteProject(id: string) {
  const manifest = await readManifest(id)
  if (manifest !== null) {
    for (const cell of manifest.cells ?? []) {
      await deleteRgbaCache(cell.clipId)
      await deleteClipBlob(id, cell.cellId, "720p")
      await deleteClipBlob(id, cell.cellId, "270p")
    }
  }
  await deleteProjectDir(id)
}
```

### 7. Record-stop flow

`src/hud/main.tsx`'s record-stop handler:

1. `captureSession.stop()` returns both blobs (~100-150 ms based on [30c](../../../experiments/30c_audio-split-pipeline/README.md)'s finalize timings)
2. `saveClipBlob(cellId, "720p", canonicalBlob)` and `saveClipBlob(cellId, "270p", mipBlob)` in parallel
3. Demux the 270p blob once to derive cache metadata (`width`, `height`, `frames`, `sourceFps`) — this is the decode that populates the rgba cache anyway, so reuse its output
4. `blobToClip` writes the rgba cache file, spawns reader, returns the Clip
5. `ClipStore.setClip(cellId, clip, clipId, cacheMetadata)` updates store + manifest atomically

## Out of scope (phase 4+)

- **Hardware-accelerated AV1 encode** when available (per-device probe). The dual-encode pipeline doesn't preclude HW encode in either branch; it just happens to use SW today.
- **Multi-mip-pyramid storage** beyond 720p + 270p. Could add 540p or other intermediate mips if usage shapes demand it. Not needed for current K=9 ceiling.
- **Worker-side video encode**. The encoders run on the main thread; moving them to workers would free additional CPU for playback but complicate the resize handoff. Re-measure if K=16 record-while-playing becomes a target.
- **Storage-pressure-driven eviction** of RGBA cache. Phase 3's GC is manifest-driven; LRU eviction under quota pressure is later.
- **Transport `registerSeek` wiring** to bitmap sources for boundary-driven cursor resets. API exists since phase 1, no consumer yet. Phase 4.
- **Shared reader worker pool**. Per-clip workers are correct for current scale.
- **`SharedArrayBuffer`** for zero-overhead frame transfer (needs COOP/COEP headers).
- **Live camera adapter moving to OPFS** — stays in-memory; transient.
- **A 60-90 s thermal sustainment test.** Headroom in [30g](../../../experiments/30g_dual-encode-720p-and-270p/README.md) (~10× over realtime per encoder) suggests this is safe but worth confirming as a follow-up experiment.

## Touch surface

| File | Action |
|---|---|
| `src/media/capture.ts` | New: `startCapture(stream)` → `CaptureSession` with dual encoders + audio + WebGL resize |
| `src/media/resize-rig.ts` | New: `setupResizeRig(width, height)` + `resizeWithWebgl(rig, frame, ts)` — extracted from the 30g/30c experiment code |
| `src/storage/opfs.ts` | `saveClipBlob(cellId, mip, blob)` + `loadClipBlob(cellId, mip)` + `deleteClipBlob(cellId, mip)` gain a `"720p" \| "270p"` argument; `ProjectManifest.cells: CellRecord[]` schema; legacy migration on read |
| `src/storage/rgba-cache.ts` | Add `garbageCollectRgbaCache(keep: Set<string>)`; (`writeRgbaCache`, `deleteRgbaCache`, `rgbaCacheExists`, `RGBA_DIR_NAME` unchanged) |
| `src/media/bitmap-source.ts` | `makeBitmapSource` gains hot path: if `rgbaCacheExists(clipId)` and cache metadata is present in the manifest, spawn reader without decoding |
| `src/clips/clip.ts` | `blobToClip(cellId, mipBlob, options?)` — accept optional persisted `clipId` + cache metadata; reuse if present |
| `src/state/projects.ts` | Replace startup `wipeRgbaCache()` with `garbageCollectRgbaCache(expectedSet)`; thread `cells` (with clipIds + cache metadata) through save/load; restore `deleteRgbaCache` + per-mip blob delete in `deleteProject` |
| `src/hud/main.tsx` | Record-stop: replace MediaRecorder with `startCapture(stream)`; on `stop`: save both blobs, build Clip from mip, update manifest with `cells` entry |
| `src/state/projects.test.ts` *(if exists)* | Update for new manifest schema |

Order:
1. Resize rig (`src/media/resize-rig.ts`) — extract from experiment, unit-shape test
2. Capture session (`src/media/capture.ts`) — depends on resize rig
3. Storage layout: two-mip `saveClipBlob`/`loadClipBlob` + manifest schema
4. Hot-path cache reuse in `makeBitmapSource`
5. Wire record-stop to capture session
6. Startup GC + `deleteProject` per-mip cleanup
7. Legacy manifest migration handling
8. E2E regression + new tests

## Success criteria

- All phase 1 + phase 2 E2E tests pass (~55 tests).
- New test `tests/c2-dual-mip-record.spec.ts`: record a clip, assert both `<cellId>.720p.webm` and `<cellId>.270p.webm` exist in OPFS and demux as AV1.
- New test `tests/c2-cache-survives-reload.spec.ts`: record a clip, reload the page, assert the rgba cache file is reused (verifiable via a timing or trace assertion: cold-start step skipped on second load).
- New test `tests/c2-av-sync.spec.ts`: record a 6 s clip, assert A/V drift in each WebM is ≤ 200 ms.
- New test `tests/c2-legacy-project-migrate.spec.ts`: load a phase-2-era project, assert it loads (no 720p file, treats existing WebM as 270p mip) and that re-recording any cell produces dual-mip output.
- Record-stop latency ≤ 200 ms in dev (informational; verify manually).
- Session reopen for a 9-cell project drops from phase 2's ~5 s to ~100 ms (informational; verify manually).
- Persistent storage per 9-cell session: ~10-20 MB (was ~25-50 MB phase 2).
- No functional regression: record, play, loop, multi-cell record-while-playing at K=9, project save/load/delete all work.

## Risks

- **Dual file save at record-stop.** Two `saveClipBlob` calls per record-stop; if one succeeds and the other fails (OPFS quota, IO error), the manifest could reference a clip that's missing one mip. Mitigation: write blobs first, then atomically update the manifest; if either blob save fails, roll back (delete the partial one) and surface error.
- **Audio in both WebMs duplicates ~14-16 KB/s of opus.** Negligible compared to the video bytes (~12-20 KB/s for 270p, ~150 KB/s for 720p), but doubles audio bandwidth. Alternative: audio in 270p only, 720p video-only (saves ~150 KB per 10 s clip). Defer this optimization; self-contained-WebMs is simpler.
- **Legacy manifest migration.** Existing user projects' manifests use `cellIds: string[]`. On first load, derive `cellIds`, generate fresh `clipId`s, populate `cells` with derived metadata, persist on next save. Old clips remain as single-mip WebMs (the existing path treats them as 270p source); new recordings produce both mips.
- **WebGL context loss.** Mobile Chrome can drop the WebGL context on backgrounding. The capture session's WebGL resize rig must handle `webglcontextlost`/`webglcontextrestored` events; on loss, abort the in-flight recording with a graceful error. Mitigation: detect and surface; user can retry. (Phase 1's renderer already deals with this for the main canvas; pattern is established.)
- **A/V drift growth over long sessions.** [30c](../../../experiments/30c_audio-split-pipeline/README.md) measured 28 ms over 10 s. Likely linear growth (audio and video clocks aren't perfectly co-driven). For a 60 s clip, drift could be 150-300 ms — still within tolerance. For multi-minute clips, may need explicit resync. Out of scope for phase 3; revisit if long-clip use cases emerge.
- **WebGL canvas-transfer per-frame allocation.** `transferToImageBitmap` creates a new ImageBitmap per call. At 30 fps that's 30 short-lived bitmaps/s, eligible for GC. Measured no impact in [30g re-run](../../../experiments/30g_dual-encode-720p-and-270p/README.md) — pendingMax stayed at 1, no GC pauses visible — but worth keeping an eye on under long sessions.
- **`MediaStreamAudioTrackSource.errorPromise` is fire-and-forget.** If audio capture fails partway through a recording, the video encoders keep going but the resulting WebM has truncated audio. Mitigation: wire `errorPromise` rejection to abort the capture session and surface the error.
