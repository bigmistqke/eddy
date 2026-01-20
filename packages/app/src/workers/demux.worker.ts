/**
 * Demux Worker
 *
 * Thin RPC wrapper around makeDemuxer. Handles demuxing of media files.
 */

import { expose, handle, type Handled } from '@bigmistqke/rpc/messenger'
import { makeDemuxer, type DemuxedSample, type DemuxerInfo } from '@eddy/media'
import { debug } from '@eddy/utils'

const log = debug('demux-worker.worker', false)

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

/** Methods returned by init() as a sub-proxy */
export interface DemuxerMethods {
  /** Get demuxer info (duration, tracks, etc.) */
  getInfo(): DemuxerInfo

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

export interface DemuxWorkerMethods {
  /** Initialize demuxer with file data, returns methods as sub-proxy */
  init(buffer: ArrayBuffer): Promise<Handled<DemuxerMethods>>
}

/**********************************************************************************/
/*                                                                                */
/*                                    Expose                                      */
/*                                                                                */
/**********************************************************************************/

expose<DemuxWorkerMethods>({
  async init(buffer) {
    log('init', { size: buffer.byteLength })

    const demuxer = await makeDemuxer(buffer)
    log('init complete', { duration: demuxer.info.duration })

    return handle({
      getInfo() {
        return demuxer.info
      },

      getVideoConfig() {
        return demuxer.getVideoConfig()
      },

      getAudioConfig() {
        return demuxer.getAudioConfig()
      },

      getSamples(trackId, startTime, endTime) {
        return demuxer.getSamples(trackId, startTime, endTime)
      },

      getAllSamples(trackId) {
        return demuxer.getAllSamples(trackId)
      },

      getKeyframeBefore(trackId, time) {
        return demuxer.getKeyframeBefore(trackId, time)
      },

      destroy() {
        log('destroy')
        demuxer.destroy()
      },
    } satisfies DemuxerMethods)
  },
})
