// combo-hw-sw — mixed HW + SW decoders running concurrently. Tests
// whether HW and SW are independent bandwidth pools (combo ≈ 2× each
// alone) or share a bottleneck (combo ≈ either alone).

import { wait } from "../../src/utils"
import { recordProbeInput, type ProbeInput } from "../harness/input"
import { reportResult, status } from "../harness/report"

const params = {
  captureResolution: { width: 1280, height: 720 },
  sourceSeconds: 6,
  runSeconds: 10,
  maxQueue: 8,
  passes: [
    { label: "hw-4", hw: 4, sw: 0 },
    { label: "sw-4", hw: 0, sw: 4 },
    { label: "combo-2+2", hw: 2, sw: 2 },
    { label: "combo-4+4", hw: 4, sw: 4 },
    { label: "combo-2+4", hw: 2, sw: 4 },
  ],
}

interface PerDecoderStats {
  id: number
  kind: "hw" | "sw"
  framesDecoded: number
  fps: number
  firstQuarterFps: number
  lastQuarterFps: number
}

interface PassReport {
  label: string
  hw: number
  sw: number
  totalFrames: number
  aggregateFps: number
  hwAggregateFps: number
  swAggregateFps: number
  perDecoder: PerDecoderStats[]
  errors: string[]
}

async function runPass(
  source: ProbeInput,
  pass: (typeof params.passes)[number],
): Promise<PassReport> {
  status(`PASS [${pass.label}] HW=${pass.hw} SW=${pass.sw}`)
  const errors: string[] = []
  const stopped = { value: false }
  interface Entry {
    decoder: VideoDecoder
    kind: "hw" | "sw"
    framesDecoded: number
  }
  const entries: Entry[] = []
  const all: Array<{ kind: "hw" | "sw"; pref: HardwareAcceleration }> = [
    ...Array.from({ length: pass.hw }, () => ({
      kind: "hw" as const,
      pref: "prefer-hardware" as HardwareAcceleration,
    })),
    ...Array.from({ length: pass.sw }, () => ({
      kind: "sw" as const,
      pref: "prefer-software" as HardwareAcceleration,
    })),
  ]
  for (let i = 0; i < all.length; i++) {
    const slot = all[i]
    const entry: Entry = {
      decoder: null as unknown as VideoDecoder,
      kind: slot.kind,
      framesDecoded: 0,
    }
    entry.decoder = new VideoDecoder({
      output(frame) {
        entry.framesDecoded++
        frame.close()
      },
      error(error) {
        errors.push(`${slot.kind}${i}: ${error.message}`)
      },
    })
    try {
      entry.decoder.configure({ ...source.config, hardwareAcceleration: slot.pref })
    } catch (error) {
      errors.push(`${slot.kind}${i} configure: ${error instanceof Error ? error.message : String(error)}`)
    }
    entries.push(entry)
  }

  // Quarter snapshots for thermal drift.
  const quarterMs = (params.runSeconds * 1000) / 4
  const snapAt1: number[] = entries.map(() => 0)
  const snapAt3: number[] = entries.map(() => 0)
  const t1 = window.setTimeout(() => {
    for (let i = 0; i < entries.length; i++) {
      snapAt1[i] = entries[i].framesDecoded
    }
  }, quarterMs)
  const t3 = window.setTimeout(() => {
    for (let i = 0; i < entries.length; i++) {
      snapAt3[i] = entries[i].framesDecoded
    }
  }, quarterMs * 3)

  const tasks = entries.map(async (entry, idx) => {
    const slot = all[idx]
    while (!stopped.value) {
      for (const chunk of source.chunks) {
        if (stopped.value) {
          break
        }
        try {
          entry.decoder.decode(chunk)
        } catch (error) {
          errors.push(`decode: ${error instanceof Error ? error.message : String(error)}`)
          stopped.value = true
          break
        }
        while (entry.decoder.decodeQueueSize > params.maxQueue && !stopped.value) {
          await wait(1)
        }
      }
      if (stopped.value) {
        break
      }
      try {
        await entry.decoder.flush()
        entry.decoder.reset()
        entry.decoder.configure({ ...source.config, hardwareAcceleration: slot.pref })
      } catch {
        break
      }
    }
  })
  await wait(params.runSeconds * 1000)
  stopped.value = true
  window.clearTimeout(t1)
  window.clearTimeout(t3)
  await Promise.all(tasks)
  for (const entry of entries) {
    try {
      entry.decoder.close()
    } catch {}
  }

  const perDecoder: PerDecoderStats[] = entries.map((e, i) => ({
    id: i,
    kind: e.kind,
    framesDecoded: e.framesDecoded,
    fps: e.framesDecoded / params.runSeconds,
    firstQuarterFps: snapAt1[i] / (quarterMs / 1000),
    lastQuarterFps: (e.framesDecoded - snapAt3[i]) / (quarterMs / 1000),
  }))
  const hwAggregateFps = perDecoder.filter(d => d.kind === "hw").reduce((s, d) => s + d.fps, 0)
  const swAggregateFps = perDecoder.filter(d => d.kind === "sw").reduce((s, d) => s + d.fps, 0)
  const totalFrames = entries.reduce((s, e) => s + e.framesDecoded, 0)
  return {
    label: pass.label,
    hw: pass.hw,
    sw: pass.sw,
    totalFrames,
    aggregateFps: totalFrames / params.runSeconds,
    hwAggregateFps,
    swAggregateFps,
    perDecoder,
    errors,
  }
}

async function run(): Promise<void> {
  status(`combo-hw-sw: ${params.passes.length} passes × ${params.runSeconds}s each`)
  status(`recording source clip (${params.sourceSeconds}s)...`)
  const source = await recordProbeInput(
    params.captureResolution.width,
    params.captureResolution.height,
    params.sourceSeconds,
  )
  status(`  got ${source.width}x${source.height}, ${source.chunks.length} chunks`)

  const reports: PassReport[] = []
  for (const pass of params.passes) {
    const report = await runPass(source, pass)
    reports.push(report)
    const driftSummary = report.perDecoder
      .map(d => `${d.kind}${d.id}: ${d.firstQuarterFps.toFixed(0)}→${d.lastQuarterFps.toFixed(0)}`)
      .join(" | ")
    status(
      `  [${report.label}] aggregate=${report.aggregateFps.toFixed(1)}fps ` +
        `(hw=${report.hwAggregateFps.toFixed(1)} sw=${report.swAggregateFps.toFixed(1)}); ` +
        `drift: ${driftSummary}` +
        (report.errors.length > 0 ? `; errors=${report.errors.length}` : ""),
    )
  }
  status("done.")
  reportResult("combo-hw-sw", params, { passes: reports })
}

run().catch((error: unknown) => {
  status(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  reportResult("combo-hw-sw", params, {
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  })
})
