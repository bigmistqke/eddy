/**
 * Demux Worker
 *
 * Thin RPC wrapper around makeDemuxer. Handles demuxing of media files.
 */

import { expose, handle, type Handled } from '@bigmistqke/rpc/messenger'
import { makeDemuxer, type Demuxer } from '@eddy/media'
import { debug } from '@eddy/utils'

const log = debug('demux-worker.worker', false)

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

export interface DemuxWorkerMethods {
  /** Initialize demuxer with file data, returns methods as sub-proxy */
  init(buffer: ArrayBuffer): Promise<Handled<Demuxer>>
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
    log('init complete', { duration: demuxer.getInfo().duration })

    return handle(demuxer)
  },
})
