import { describe, it, expect, beforeAll } from 'vitest'
import { createDemuxer, type DemuxerInfo } from '../demuxer'
import { readFile } from 'fs/promises'
import { join } from 'path'

async function loadFixture(filename: string): Promise<ArrayBuffer> {
  const fixturePath = join(__dirname, 'fixtures', filename)
  const fileBuffer = await readFile(fixturePath)
  return fileBuffer.buffer.slice(
    fileBuffer.byteOffset,
    fileBuffer.byteOffset + fileBuffer.byteLength
  )
}

describe('Demuxer - Container Parsing', () => {
  let testBuffer: ArrayBuffer
  let testWithAudioBuffer: ArrayBuffer

  beforeAll(async () => {
    testBuffer = await loadFixture('test.mp4')
    testWithAudioBuffer = await loadFixture('test-with-audio.mp4')
  })

  it('should parse an MP4 file and return demuxer info', async () => {
    const demuxer = await createDemuxer(testBuffer)

    expect(demuxer).toBeDefined()
    expect(demuxer.info).toBeDefined()
    expect(demuxer.file).toBeDefined()

    demuxer.destroy()
  })

  it('should extract video track info', async () => {
    const demuxer = await createDemuxer(testBuffer)

    expect(demuxer.info.videoTracks.length).toBeGreaterThan(0)

    const videoTrack = demuxer.info.videoTracks[0]
    expect(videoTrack.id).toBeDefined()
    expect(videoTrack.codec).toBeDefined()
    expect(videoTrack.width).toBeGreaterThan(0)
    expect(videoTrack.height).toBeGreaterThan(0)
    expect(videoTrack.duration).toBeGreaterThan(0)
    expect(videoTrack.timescale).toBeGreaterThan(0)
    expect(videoTrack.sampleCount).toBeGreaterThan(0)

    demuxer.destroy()
  })

  it('should extract audio track info', async () => {
    const demuxer = await createDemuxer(testWithAudioBuffer)

    expect(demuxer.info.audioTracks.length).toBeGreaterThan(0)

    const audioTrack = demuxer.info.audioTracks[0]
    expect(audioTrack.id).toBeDefined()
    expect(audioTrack.codec).toBeDefined()
    expect(audioTrack.sampleRate).toBeGreaterThan(0)
    expect(audioTrack.channelCount).toBeGreaterThan(0)
    expect(audioTrack.duration).toBeGreaterThan(0)
    expect(audioTrack.timescale).toBeGreaterThan(0)
    expect(audioTrack.sampleCount).toBeGreaterThan(0)

    demuxer.destroy()
  })

  it('should handle video-only files', async () => {
    const demuxer = await createDemuxer(testBuffer)

    // This file has no audio
    expect(demuxer.info.audioTracks.length).toBe(0)
    expect(demuxer.info.videoTracks.length).toBeGreaterThan(0)

    demuxer.destroy()
  })

  it('should report correct file-level metadata', async () => {
    const demuxer = await createDemuxer(testBuffer)

    expect(demuxer.info.duration).toBeGreaterThan(0)
    expect(demuxer.info.timescale).toBeGreaterThan(0)
    expect(typeof demuxer.info.isFragmented).toBe('boolean')

    demuxer.destroy()
  })

  it('should accept a File object', async () => {
    // Create a File from the buffer
    const blob = new Blob([testBuffer], { type: 'video/mp4' })
    const file = new File([blob], 'test.mp4', { type: 'video/mp4' })

    const demuxer = await createDemuxer(file)

    expect(demuxer).toBeDefined()
    expect(demuxer.info.videoTracks.length).toBeGreaterThan(0)

    demuxer.destroy()
  })
})
