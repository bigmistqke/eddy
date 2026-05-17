// resolution-codec-pool — sweep {720p, 540p, 360p} × {vp9-hw-4,
// av1-sw-4, cross-4+4}. Tests whether 20c's cross-codec non-additivity
// shrinks at lower res (memory bandwidth hypothesis) and how much the
// single-pool ceiling rises at smaller cell sizes.

import { wait } from "../../src/utils"
import { recordProbeInput, type ProbeInput } from "../harness/input"
import { reportResult, status } from "../harness/report"

const params = {
  captureResolution: { width: 1280, height: 720 },
  sourceSeconds: 6,
  runSeconds: 10,
  maxQueue: 8,
  bitratePerPixel: 0.1,
  resolutions: [
    { label: "720p", width: 1280, height: 720 },
    { label: "540p", width: 960, height: 544 },
    { label: "360p", width: 640, height: 368 },
  ],
  hwCodec: { label: "vp9", codecString: "vp09.00.10.08" },
  swCodec: { label: "av1", codecString: "av01.0.04M.08" },
  passes: [
    { label: "vp9-hw-4", hw: 4, sw: 0 },
    { label: "av1-sw-4", hw: 0, sw: 4 },
    { label: "cross-4+4", hw: 4, sw: 4 },
  ],
}

interface TranscodeAsset {
  codecLabel: string
  resolutionLabel: string
  width: number
  height: number
  config: VideoDecoderConfig
  chunks: EncodedVideoChunk[]
  bytesPerSecOfContent: number
  errors: string[]
}

/** Decode source → downscale to target res via OffscreenCanvas →
 *  re-encode in target codec. */
async function transcodeCodecRes(
  source: ProbeInput,
  codecLabel: string,
  codecString: string,
  resolutionLabel: string,
  targetWidth: number,
  targetHeight: number,
): Promise<TranscodeAsset | null> {
  const errors: string[] = []
  const snap16 = (value: number): number => Math.max(16, Math.round(value / 16) * 16)
  const width = snap16(targetWidth)
  const height = snap16(targetHeight)
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext("2d")
  if (context === null) {
    errors.push("no 2d context")
    return null
  }
  const chunks: EncodedVideoChunk[] = []
  let decoderConfig: VideoDecoderConfig | null = null
  const bitrate = Math.round(width * height * 30 * params.bitratePerPixel)
  const encoder = new VideoEncoder({
    output(chunk, metadata) {
      chunks.push(chunk)
      if (decoderConfig === null && metadata?.decoderConfig) {
        decoderConfig = metadata.decoderConfig
      }
    },
    error(error) {
      errors.push(`enc: ${error.message}`)
    },
  })
  try {
    encoder.configure({
      codec: codecString,
      width,
      height,
      bitrate,
      framerate: 30,
    })
  } catch (error) {
    encoder.close()
    errors.push(`configure: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }

  let frameIdx = 0
  const sourceDecoder = new VideoDecoder({
    output(frame) {
      try {
        context.drawImage(frame, 0, 0, width, height)
        const scaled = new VideoFrame(canvas, { timestamp: frame.timestamp })
        encoder.encode(scaled, { keyFrame: frameIdx === 0 })
        scaled.close()
      } catch (error) {
        errors.push(`scale: ${error instanceof Error ? error.message : String(error)}`)
      }
      frame.close()
      frameIdx++
    },
    error(error) {
      errors.push(`source-dec: ${error.message}`)
    },
  })
  sourceDecoder.configure(source.config)
  for (const chunk of source.chunks) {
    sourceDecoder.decode(chunk)
  }
  await sourceDecoder.flush()
  sourceDecoder.close()
  try {
    await encoder.flush()
  } catch (error) {
    errors.push(`enc-flush: ${error instanceof Error ? error.message : String(error)}`)
  }
  encoder.close()
  const totalBytes = chunks.reduce((s, c) => s + c.byteLength, 0)
  const contentSeconds = frameIdx / 30
  if (chunks.length === 0 || decoderConfig === null) {
    return null
  }
  return {
    codecLabel,
    resolutionLabel,
    width,
    height,
    config: decoderConfig,
    chunks,
    bytesPerSecOfContent: contentSeconds > 0 ? totalBytes / contentSeconds : 0,
    errors,
  }
}

interface PerDecoderStats {
  id: number
  pool: "vp9-hw" | "av1-sw"
  framesDecoded: number
  fps: number
  firstQuarterFps: number
  lastQuarterFps: number
}

interface PassReport {
  label: string
  hw: number
  sw: number
  aggregateFps: number
  hwPoolFps: number
  swPoolFps: number
  perDecoder: PerDecoderStats[]
  errors: string[]
}

async function runPass(
  hwAsset: TranscodeAsset,
  swAsset: TranscodeAsset,
  pass: (typeof params.passes)[number],
): Promise<PassReport> {
  const errors: string[] = []
  const stopped = { value: false }
  interface Entry {
    decoder: VideoDecoder
    pool: "vp9-hw" | "av1-sw"
    asset: TranscodeAsset
    pref: HardwareAcceleration
    framesDecoded: number
  }
  const slots: Array<{
    pool: "vp9-hw" | "av1-sw"
    asset: TranscodeAsset
    pref: HardwareAcceleration
  }> = [
    ...Array.from({ length: pass.hw }, () => ({
      pool: "vp9-hw" as const,
      asset: hwAsset,
      pref: "prefer-hardware" as HardwareAcceleration,
    })),
    ...Array.from({ length: pass.sw }, () => ({
      pool: "av1-sw" as const,
      asset: swAsset,
      pref: "prefer-software" as HardwareAcceleration,
    })),
  ]
  const entries: Entry[] = slots.map((slot, i) => {
    const entry: Entry = {
      decoder: null as unknown as VideoDecoder,
      pool: slot.pool,
      asset: slot.asset,
      pref: slot.pref,
      framesDecoded: 0,
    }
    entry.decoder = new VideoDecoder({
      output(frame) {
        entry.framesDecoded++
        frame.close()
      },
      error(error) {
        errors.push(`${slot.pool}${i}: ${error.message}`)
      },
    })
    try {
      entry.decoder.configure({ ...slot.asset.config, hardwareAcceleration: slot.pref })
    } catch (error) {
      errors.push(
        `${slot.pool}${i} configure: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    return entry
  })

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

  const tasks = entries.map(async entry => {
    while (!stopped.value) {
      for (const chunk of entry.asset.chunks) {
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
        await Promise.race([entry.decoder.flush(), wait(3000)])
        if (stopped.value) {
          break
        }
        entry.decoder.reset()
        entry.decoder.configure({ ...entry.asset.config, hardwareAcceleration: entry.pref })
      } catch {
        break
      }
    }
  })
  await wait(params.runSeconds * 1000)
  stopped.value = true
  window.clearTimeout(t1)
  window.clearTimeout(t3)
  await Promise.race([Promise.all(tasks), wait(3000)])
  for (const entry of entries) {
    try {
      entry.decoder.close()
    } catch {}
  }

  const perDecoder: PerDecoderStats[] = entries.map((e, i) => ({
    id: i,
    pool: e.pool,
    framesDecoded: e.framesDecoded,
    fps: e.framesDecoded / params.runSeconds,
    firstQuarterFps: snapAt1[i] / (quarterMs / 1000),
    lastQuarterFps: (e.framesDecoded - snapAt3[i]) / (quarterMs / 1000),
  }))
  const hwPoolFps = perDecoder
    .filter(d => d.pool === "vp9-hw")
    .reduce((s, d) => s + d.fps, 0)
  const swPoolFps = perDecoder
    .filter(d => d.pool === "av1-sw")
    .reduce((s, d) => s + d.fps, 0)
  return {
    label: pass.label,
    hw: pass.hw,
    sw: pass.sw,
    aggregateFps: hwPoolFps + swPoolFps,
    hwPoolFps,
    swPoolFps,
    perDecoder,
    errors,
  }
}

interface ResolutionReport {
  label: string
  width: number
  height: number
  hwAssetBytesPerSec: number
  swAssetBytesPerSec: number
  passes: PassReport[]
  additivityRatio: number | null
}

async function runResolution(
  source: ProbeInput,
  res: (typeof params.resolutions)[number],
): Promise<ResolutionReport | null> {
  status(`RES [${res.label}] ${res.width}×${res.height}`)
  status(`  transcoding to ${params.hwCodec.label}...`)
  const hwAsset = await transcodeCodecRes(
    source,
    params.hwCodec.label,
    params.hwCodec.codecString,
    res.label,
    res.width,
    res.height,
  )
  status(`  transcoding to ${params.swCodec.label}...`)
  const swAsset = await transcodeCodecRes(
    source,
    params.swCodec.label,
    params.swCodec.codecString,
    res.label,
    res.width,
    res.height,
  )
  if (hwAsset === null || swAsset === null) {
    status(`  transcode failed (hw=${hwAsset !== null} sw=${swAsset !== null})`)
    return null
  }
  status(
    `  ${hwAsset.codecLabel}: ${hwAsset.chunks.length} chunks, ${hwAsset.bytesPerSecOfContent.toFixed(0)} B/s; ` +
      `${swAsset.codecLabel}: ${swAsset.chunks.length} chunks, ${swAsset.bytesPerSecOfContent.toFixed(0)} B/s`,
  )

  const passes: PassReport[] = []
  for (const pass of params.passes) {
    status(`  PASS [${pass.label}] HW=${pass.hw} SW=${pass.sw}`)
    const report = await runPass(hwAsset, swAsset, pass)
    passes.push(report)
    status(
      `    aggregate=${report.aggregateFps.toFixed(1)}fps ` +
        `(${params.hwCodec.label}-hw=${report.hwPoolFps.toFixed(1)} ${params.swCodec.label}-sw=${report.swPoolFps.toFixed(1)})` +
        (report.errors.length > 0 ? ` errors=${report.errors.length}` : ""),
    )
  }
  // Free chunks before next resolution.
  hwAsset.chunks.length = 0
  swAsset.chunks.length = 0

  const baselineSum =
    (passes.find(p => p.label === "vp9-hw-4")?.aggregateFps ?? 0) +
    (passes.find(p => p.label === "av1-sw-4")?.aggregateFps ?? 0)
  const cross = passes.find(p => p.label === "cross-4+4")?.aggregateFps ?? 0
  return {
    label: res.label,
    width: hwAsset.width,
    height: hwAsset.height,
    hwAssetBytesPerSec: hwAsset.bytesPerSecOfContent,
    swAssetBytesPerSec: swAsset.bytesPerSecOfContent,
    passes,
    additivityRatio: baselineSum > 0 ? cross / baselineSum : null,
  }
}

async function run(): Promise<void> {
  status(
    `resolution-codec-pool: ${params.resolutions.length} res × ${params.passes.length} passes × ${params.runSeconds}s`,
  )
  status(`recording VP8 source clip (${params.sourceSeconds}s)...`)
  const source = await recordProbeInput(
    params.captureResolution.width,
    params.captureResolution.height,
    params.sourceSeconds,
  )
  status(`  got ${source.width}x${source.height}, ${source.chunks.length} chunks`)

  const reports: ResolutionReport[] = []
  for (const res of params.resolutions) {
    const report = await runResolution(source, res)
    if (report !== null) {
      reports.push(report)
      status(
        `RES [${report.label}] additivity = ${
          report.additivityRatio !== null ? (report.additivityRatio * 100).toFixed(0) + "%" : "n/a"
        }`,
      )
    }
  }
  status("done.")
  reportResult("resolution-codec-pool", params, { resolutions: reports })
}

run().catch((error: unknown) => {
  status(`ERROR: ${error instanceof Error ? error.message : String(error)}`)
  reportResult("resolution-codec-pool", params, {
    error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
  })
})
