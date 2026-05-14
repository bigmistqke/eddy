# Video playback scaling — prototypes

Throwaway capability spikes, each answering one question about how to scale
video playback to many simultaneous cells on low-end Android (target:
Samsung Galaxy A15 / SM-A155F). Background + the architecture hypotheses
they test: `docs/superpowers/specs/2026-05-14-video-playback-scaling-design.md`.

**These are throwaway.** When a prototype has answered its question, record
the verdict here and delete or absorb the code.

## How to run

```sh
pnpm dev                                  # serve (note the port)
PORT=<port> scripts/prototypes/run.sh <prototype-name>
```

`run.sh` handles the phone: wake, `adb reverse`, grant Chrome's OS
camera/mic permissions, forward the DevTools socket, then `run-cdp.mjs`
grants the site permission, navigates to the prototype page, and prints its
`[prototype-result]` JSON.

Shared harness in `harness/`: `input.ts` (record + demux a fresh clip on
device), `fallback-detect.ts` (throughput-collapse detector).

## Prototypes

### raw-capability — _question:_ what are the device's raw decode/upload limits?

Measures M1 concurrent `VideoDecoder` ceiling, M2 reset/reconfigure cost,
M3 single-decoder throughput, M4 `texImage2D` upload cost.

**Verdict (2026-05-14, Galaxy A15 / Android 10 / Chrome 148):**
The original design's load-bearing premise — "Android caps concurrent
decoders at 2–4" — is **falsified** on a budget device.

- **M1 = 32, `max-reached`** — allocated 32 concurrent `VideoDecoder`s
  (each configured + decoded one keyframe, all kept alive), zero errors,
  no throughput collapse. True ceiling unknown — we hit the probe's cap.
- **M2 = 6.3ms mean** reset→configure→decode→flush (43ms warmup, then
  ~4–6ms). Time-slicing one decoder across streams is cheap.
- **M3** single-decoder throughput: hi-res 240×320 → 549fps → 18.3
  realtime cells; lo-res 132×176 → 1466fps → 48.9 cells.
- **M4** `texImage2D`: 0.21ms hi-res / 0.075ms lo-res — negligible.

Per the design doc's decision rule (M1 ≥ ~16 AND M4 cheap → streaming
viable, revisit family), this **reopens the architecture question in
favour of streaming**. Caveat: M1 only proves *instantiation* — each
decoder decoded one keyframe, not sustained concurrent decode. The
decoder-pools prototype must confirm sustained N-decoder throughput
before the composite is fully ruled out.

Next: raise `MAX_DECODERS` to find the true ceiling, and build
decoder-pools for the sustained-decode test.

### decoder-pools — _question:_ is the decoder pool actually dead?

_Not yet built._ K decoders round-robin GOP-decode-ahead across N>K cells.

**Verdict:** _pending._

### windowed-previews — _question:_ can per-cell ring buffers give bounded memory at acceptable quality?

_Not yet built._

**Verdict:** _pending._

### compositing-full-video — _question:_ does 1-decode-1-upload scale to large N, and what's the rebuild cost?

_Not yet built._

**Verdict:** _pending._
