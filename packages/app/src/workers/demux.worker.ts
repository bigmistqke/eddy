import { expose } from '@bigmistqke/rpc/messenger'
import {
  createDemuxer,
  type Demuxer,
  type DemuxedSample,
  type DemuxerInfo,
} from '@eddy/media'
import { debug } from '@eddy/utils'

const log = debug('demux-worker', false)

export interface DemuxWorkerMethods {
  /** Initialize demuxer with file data */
  init(buffer: ArrayBuffer): Promise<DemuxerInfo>

  /** Get WebCodecs VideoDecoderConfig */
  getVideoConfig(): Promise<VideoDecoderConfig>

  /** Get WebCodecs AudioDecoderConfig */
  getAudioConfig(): Promise<AudioDecoderConfig>

  /** Get samples in time range */
  getSamples(trackId: number, startTime: number, endTime: number): Promise<DemuxedSample[]>

  /** Get all samples from track */
  getAllSamples(trackId: number): Promise<DemuxedSample[]>

  /** Find keyframe at or before time */
  getKeyframeBefore(trackId: number, time: number): Promise<DemuxedSample | null>

  /** Clean up resources */
  destroy(): void
}

/**********************************************************************************/
/*                                                                                */
/*                                     Methods                                    */
/*                                                                                */
/**********************************************************************************/

// Worker state
let demuxer: Demuxer | null = null

expose<DemuxWorkerMethods>({
  async init(buffer) {
    log('init', { size: buffer.byteLength })

    // Clean up previous instance
    if (demuxer) {
      demuxer.destroy()
    }

    demuxer = await createDemuxer(buffer)
    log('init complete', { duration: demuxer.info.duration })

    return demuxer.info
  },

  async getVideoConfig() {
    if (!demuxer) {
      throw new Error('Demuxer not initialized')
    }
    return demuxer.getVideoConfig()
  },

  async getAudioConfig() {
    if (!demuxer) {
      throw new Error('Demuxer not initialized')
    }
    return demuxer.getAudioConfig()
  },

  async getSamples(trackId, startTime, endTime) {
    if (!demuxer) {
      throw new Error('Demuxer not initialized')
    }
    return demuxer.getSamples(trackId, startTime, endTime)
  },

  async getAllSamples(trackId) {
    if (!demuxer) {
      throw new Error('Demuxer not initialized')
    }
    return demuxer.getAllSamples(trackId)
  },

  async getKeyframeBefore(trackId, time) {
    if (!demuxer) {
      throw new Error('Demuxer not initialized')
    }
    return demuxer.getKeyframeBefore(trackId, time)
  },

  destroy() {
    log('destroy')
    if (demuxer) {
      demuxer.destroy()
      demuxer = null
    }
  },
})
