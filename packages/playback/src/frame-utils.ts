import type { DemuxedSample } from '@eddy/codecs'
import { debug } from '@eddy/utils'

const log = debug('playback:frame-utils', false)

/** Plane layout for VideoFrame reconstruction */
export interface PlaneLayout {
  offset: number
  stride: number
}

/** Raw frame data for buffering */
export interface FrameData {
  buffer: ArrayBuffer
  format: VideoPixelFormat
  codedWidth: number
  codedHeight: number
  displayWidth: number
  displayHeight: number
  timestamp: number // microseconds
  duration: number // microseconds
  layout: PlaneLayout[]
}

/** Align value up to nearest multiple of alignment */
export function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment
}

/** Calculate aligned layout for a video format (128-byte alignment for GPU compatibility) */
export function calculateAlignedLayout(
  format: string, // Use string to allow newer formats not in TS types
  width: number,
  height: number,
): { layout: PlaneLayout[]; totalSize: number } {
  const ALIGNMENT = 128

  // Determine bytes per sample (10/12-bit formats use 2 bytes)
  const bytesPerSample = format.includes('P10') || format.includes('P12') ? 2 : 1
  const hasAlpha = format.includes('A') && format !== 'RGBA' && format !== 'BGRA'

  // I420 family (4:2:0 subsampling)
  if (format.startsWith('I420')) {
    const yStride = alignUp(width * bytesPerSample, ALIGNMENT)
    const uvStride = alignUp((width / 2) * bytesPerSample, ALIGNMENT)
    const ySize = yStride * height
    const uvSize = uvStride * (height / 2)

    const layout: PlaneLayout[] = [
      { offset: 0, stride: yStride },
      { offset: ySize, stride: uvStride },
      { offset: ySize + uvSize, stride: uvStride },
    ]

    if (hasAlpha) {
      layout.push({ offset: ySize + uvSize * 2, stride: yStride })
      return { layout, totalSize: ySize * 2 + uvSize * 2 }
    }

    return { layout, totalSize: ySize + uvSize * 2 }
  }

  // I422 family (4:2:2 subsampling)
  if (format.startsWith('I422')) {
    const yStride = alignUp(width * bytesPerSample, ALIGNMENT)
    const uvStride = alignUp((width / 2) * bytesPerSample, ALIGNMENT)
    const ySize = yStride * height
    const uvSize = uvStride * height

    const layout: PlaneLayout[] = [
      { offset: 0, stride: yStride },
      { offset: ySize, stride: uvStride },
      { offset: ySize + uvSize, stride: uvStride },
    ]

    if (hasAlpha) {
      layout.push({ offset: ySize + uvSize * 2, stride: yStride })
      return { layout, totalSize: ySize * 2 + uvSize * 2 }
    }

    return { layout, totalSize: ySize + uvSize * 2 }
  }

  // I444 family (4:4:4 no subsampling)
  if (format.startsWith('I444')) {
    const stride = alignUp(width * bytesPerSample, ALIGNMENT)
    const planeSize = stride * height
    const numPlanes = hasAlpha ? 4 : 3

    const layout: PlaneLayout[] = []
    for (let i = 0; i < numPlanes; i++) {
      layout.push({ offset: planeSize * i, stride })
    }

    return { layout, totalSize: planeSize * numPlanes }
  }

  // NV12 family (4:2:0 with interleaved UV)
  if (format.startsWith('NV12')) {
    const yStride = alignUp(width * bytesPerSample, ALIGNMENT)
    const uvStride = alignUp(width * bytesPerSample, ALIGNMENT)
    const ySize = yStride * height
    const uvSize = uvStride * (height / 2)

    const layout: PlaneLayout[] = [
      { offset: 0, stride: yStride },
      { offset: ySize, stride: uvStride },
    ]

    if (hasAlpha) {
      layout.push({ offset: ySize + uvSize, stride: yStride })
      return { layout, totalSize: ySize * 2 + uvSize }
    }

    return { layout, totalSize: ySize + uvSize }
  }

  // RGBA/BGRA family
  if (format === 'RGBA' || format === 'RGBX' || format === 'BGRA' || format === 'BGRX') {
    const stride = alignUp(width * 4, ALIGNMENT)
    return {
      layout: [{ offset: 0, stride }],
      totalSize: stride * height,
    }
  }

  throw new Error(`Unsupported pixel format: ${format}`)
}

/** Convert VideoFrame to FrameData with aligned layout */
export async function frameToData(frame: VideoFrame, sample: DemuxedSample): Promise<FrameData> {
  if (!frame.format) {
    frame.close()
    throw new Error(`VideoFrame has null format - cannot buffer`)
  }

  const { layout, totalSize } = calculateAlignedLayout(
    frame.format,
    frame.codedWidth,
    frame.codedHeight,
  )

  log('frameToData', {
    format: frame.format,
    codedWidth: frame.codedWidth,
    codedHeight: frame.codedHeight,
    totalSize,
    layout,
  })

  const buffer = new ArrayBuffer(totalSize)
  await frame.copyTo(buffer, { layout })

  const data: FrameData = {
    buffer,
    format: frame.format,
    codedWidth: frame.codedWidth,
    codedHeight: frame.codedHeight,
    displayWidth: frame.displayWidth,
    displayHeight: frame.displayHeight,
    timestamp: sample.pts * 1_000_000,
    duration: sample.duration * 1_000_000,
    layout,
  }

  frame.close()
  return data
}

/** Convert FrameData to VideoFrame (for transfer) */
export function dataToFrame(data: FrameData): VideoFrame {
  log('dataToFrame', {
    format: data.format,
    codedWidth: data.codedWidth,
    codedHeight: data.codedHeight,
    bufferSize: data.buffer.byteLength,
  })

  return new VideoFrame(data.buffer, {
    format: data.format,
    codedWidth: data.codedWidth,
    codedHeight: data.codedHeight,
    displayWidth: data.displayWidth,
    displayHeight: data.displayHeight,
    timestamp: data.timestamp,
    duration: data.duration,
    layout: data.layout,
  })
}
