import type { Agent } from '@atproto/api'
import {
  absoluteValidators,
  absoluteWireValidators,
  isClipStem,
  isClipUrl,
  stemValidators,
  stemWireValidators,
  type AbsoluteProject,
  type Canvas,
  type ClipUrl,
  type MediaClip,
  type Stem,
  type StemRef,
} from '@eddy/lexicons'
import { debug } from '@eddy/utils'
import * as v from 'valibot'

const log = debug('atproto:crud', false)

export interface RecordRef {
  uri: string
  cid: string
}

export interface ProjectRecord {
  uri: string
  cid: string
  value: AbsoluteProject
}

export interface StemRecord {
  uri: string
  cid: string
  value: Stem
}

export interface ProjectListItem {
  uri: string
  cid: string
  rkey: string
  title: string
  createdAt: string
  trackCount: number
}

/**********************************************************************************/
/*                                                                                */
/*                                      Utils                                     */
/*                                                                                */
/**********************************************************************************/

// Helper to check if a URL clip uses opfs:// (local storage)
const isOpfsUrl = (clip: MediaClip): clip is ClipUrl =>
  isClipUrl(clip) && clip.url.startsWith('opfs://')

// Parse AT URI into components: at://did/collection/rkey
function parseAtUri(uri: string): { repo: string; collection: string; rkey: string } {
  const match = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/)
  if (!match) throw new Error(`Invalid AT URI: ${uri}`)
  return { repo: match[1], collection: match[2], rkey: match[3] }
}

// Resolve a handle to a DID
async function resolveHandle(agent: Agent, handle: string): Promise<string> {
  const response = await agent.resolveHandle({ handle })
  return response.data.did
}

async function uploadBlob(agent: Agent, blob: Blob) {
  const response = await agent.uploadBlob(blob, {
    encoding: blob.type,
  })
  return response.data.blob
}

async function makeStemRecord(agent: Agent, blob: Blob, duration: number): Promise<RecordRef> {
  const uploadedBlob = await uploadBlob(agent, blob)

  const record = v.parse(stemWireValidators.main, {
    $type: 'dj.eddy.stem',
    schemaVersion: 1,
    blob: uploadedBlob.toJSON(),
    type: 'video',
    mimeType: blob.type,
    duration: Math.round(duration),
    video: {
      hasAudio: true,
    },
    createdAt: new Date().toISOString(),
  })

  const response = await agent.com.atproto.repo.createRecord({
    repo: agent.assertDid,
    collection: 'dj.eddy.stem',
    record,
  })

  return {
    uri: response.data.uri,
    cid: response.data.cid,
  }
}

// Clone an external stem to own PDS
async function cloneStem(agent: Agent, stemUri: string): Promise<StemRef> {
  const { repo } = parseAtUri(stemUri)

  // Already ours, no need to clone
  if (repo === agent.assertDid) {
    const stem = await getStem(agent, stemUri)
    return { uri: stem.uri, cid: stem.cid }
  }

  // Fetch the blob and get duration from original stem record
  const [blob, stem] = await Promise.all([getStemBlob(agent, stemUri), getStem(agent, stemUri)])

  return makeStemRecord(agent, blob, stem.value.duration)
}

async function getStem(agent: Agent, uri: string): Promise<StemRecord> {
  const { repo, collection, rkey } = parseAtUri(uri)
  const response = await agent.com.atproto.repo.getRecord({
    repo,
    collection,
    rkey,
  })
  return {
    uri: response.data.uri,
    cid: response.data.cid ?? '',
    value: v.parse(stemValidators.main, response.data.value),
  }
}

async function getStemBlob(agent: Agent, stemUri: string): Promise<Blob> {
  const { repo } = parseAtUri(stemUri)
  const stem = await getStem(agent, stemUri)
  const blob = stem.value.blob

  // Handle both BlobRef (ref is CID) and untyped (cid is string) formats
  const blobCid = 'ref' in blob ? blob.ref.toString() : blob.cid

  log('fetching blob', { did: repo, cid: blobCid })

  // Fetch the actual blob
  const blobResponse = await agent.com.atproto.sync.getBlob({
    did: repo,
    cid: blobCid,
  })

  return new Blob([blobResponse.data as BlobPart], { type: stem.value.mimeType })
}

/** Get the PDS URL from an agent (works with both CredentialSession and OAuthSession) */
async function getPdsUrl(agent: Agent): Promise<URL> {
  const sessionManager = agent.sessionManager as {
    // CredentialSession
    dispatchUrl?: URL
    // OAuthSession
    getTokenInfo?: () => Promise<{ aud: string }>
  }

  // CredentialSession exposes dispatchUrl directly
  if (sessionManager.dispatchUrl) {
    return sessionManager.dispatchUrl
  }

  // OAuthSession has getTokenInfo which returns the PDS URL as 'aud'
  if (sessionManager.getTokenInfo) {
    const tokenInfo = await sessionManager.getTokenInfo()
    return new URL(tokenInfo.aud)
  }

  throw new Error('Cannot determine PDS URL from agent session')
}

/**********************************************************************************/
/*                                                                                */
/*                             Get Project By R Key                               */
/*                                                                                */
/**********************************************************************************/

async function getProject(agent: Agent, uri: string): Promise<ProjectRecord> {
  const { repo, collection, rkey } = parseAtUri(uri)
  const response = await agent.com.atproto.repo.getRecord({
    repo,
    collection,
    rkey,
  })
  return {
    uri: response.data.uri,
    cid: response.data.cid ?? '',
    value: v.parse(absoluteValidators.main, response.data.value),
  }
}

// Get project by handle (optional) and rkey
// If no handle provided, uses the agent's own DID
export async function getProjectByRkey(
  agent: Agent,
  rkey: string,
  handle?: string,
): Promise<ProjectRecord> {
  let did: string
  if (handle) {
    did = await resolveHandle(agent, handle)
  } else {
    did = agent.assertDid
  }

  const uri = `at://${did}/dj.eddy.absolute/${rkey}`
  return getProject(agent, uri)
}

/**********************************************************************************/
/*                                                                                */
/*                      Create Readable Stream From At Proto                      */
/*                                                                                */
/**********************************************************************************/

/** Stream a stem directly from ATProto to OPFS (avoids loading blob into memory) */
export async function createReadableStreamFromAtProto(
  agent: Agent,
  stemUri: string,
  clipId: string,
): Promise<ReadableStream<Uint8Array<ArrayBuffer>>> {
  const { repo } = parseAtUri(stemUri)
  const stem = await getStem(agent, stemUri)
  const blob = stem.value.blob

  // Handle both BlobRef (ref is CID) and untyped (cid is string) formats
  const blobCid = 'ref' in blob ? blob.ref.toString() : blob.cid

  log('streaming blob to OPFS', { did: repo, cid: blobCid, clipId })

  // Construct the blob URL and fetch with streaming
  const pdsUrl = await getPdsUrl(agent)
  const url = new URL('/xrpc/com.atproto.sync.getBlob', pdsUrl)
  url.searchParams.set('did', repo)
  url.searchParams.set('cid', blobCid)

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Failed to fetch blob: ${response.status} ${response.statusText}`)
  }
  if (!response.body) {
    throw new Error('Response body is null')
  }

  return response.body
}

/**********************************************************************************/
/*                                                                                */
/*                                       List                                     */
/*                                                                                */
/**********************************************************************************/

export async function listProjects(agent: Agent): Promise<ProjectListItem[]> {
  const response = await agent.com.atproto.repo.listRecords({
    repo: agent.assertDid,
    collection: 'dj.eddy.absolute',
    limit: 50,
  })

  return response.data.records.map(record => {
    const project = v.parse(absoluteValidators.main, record.value)
    const { rkey } = parseAtUri(record.uri)
    return {
      uri: record.uri,
      cid: record.cid,
      rkey,
      title: project.title,
      createdAt: project.createdAt,
      trackCount: project.mediaTracks.length,
    }
  })
}

export async function listStems(agent: Agent): Promise<string[]> {
  const response = await agent.com.atproto.repo.listRecords({
    repo: agent.assertDid,
    collection: 'dj.eddy.stem',
    limit: 100,
  })
  return response.data.records.map(record => record.uri)
}

/**********************************************************************************/
/*                                                                                */
/*                                      Delete                                    */
/*                                                                                */
/**********************************************************************************/

export async function deleteProject(agent: Agent, uri: string): Promise<void> {
  const { repo, rkey } = parseAtUri(uri)
  // Note: Stems are not deleted - they may be referenced by other projects
  // Use deleteOrphanedStems() for cleanup
  await agent.com.atproto.repo.deleteRecord({
    repo,
    collection: 'dj.eddy.absolute',
    rkey,
  })
}

export async function deleteStem(agent: Agent, uri: string): Promise<void> {
  const { repo, rkey } = parseAtUri(uri)
  await agent.com.atproto.repo.deleteRecord({
    repo,
    collection: 'dj.eddy.stem',
    rkey,
  })
}

export async function deleteOrphanedStems(agent: Agent): Promise<string[]> {
  // Get all stems and projects
  const [stemUris, projects] = await Promise.all([listStems(agent), listProjects(agent)])

  // Collect all stem URIs referenced by projects
  const referencedStems = new Set<string>()
  for (const projectItem of projects) {
    try {
      const project = await getProject(agent, projectItem.uri)
      // Iterate over all media tracks and their clips
      for (const track of project.value.mediaTracks) {
        for (const clip of track.clips) {
          if (isClipStem(clip)) {
            referencedStems.add(clip.ref.uri)
          }
        }
      }
    } catch {
      // Skip projects that can't be fetched
    }
  }

  // Find orphaned stems (not referenced by any project)
  const orphanedStems = stemUris.filter(uri => !referencedStems.has(uri))

  // Delete orphaned stems in parallel
  await Promise.all(orphanedStems.map(uri => deleteStem(agent, uri)))

  return orphanedStems
}

/**********************************************************************************/
/*                                                                                */
/*                                  Publish Project                               */
/*                                                                                */
/**********************************************************************************/

export async function publishProject(
  agent: Agent,
  project: AbsoluteProject,
  clipBlobs: Map<string, { blob: Blob; duration: number }>,
): Promise<RecordRef> {
  // Build media tracks with processed clips in parallel
  const mediaTracks = await Promise.all(
    project.mediaTracks.map(async track => ({
      type: 'media' as const,
      id: track.id,
      name: track.name,
      clips: await Promise.all(
        track.clips.map(async (clip): Promise<MediaClip> => {
          // Case 1: Local recording (opfs:// URL) - upload as stem
          if (isOpfsUrl(clip)) {
            const localBlob = clipBlobs.get(clip.id)
            if (!localBlob) {
              throw new Error(`Local clip ${clip.id} has no blob - cannot publish`)
            }
            const stemRef = await makeStemRecord(agent, localBlob.blob, localBlob.duration)
            return {
              type: 'stem',
              id: clip.id,
              ref: stemRef,
              start: clip.start,
              duration: clip.duration,
            }
          }

          // Case 2: Existing stem source - keep or clone
          if (isClipStem(clip)) {
            const { repo } = parseAtUri(clip.ref.uri)
            if (repo === agent.assertDid) {
              // Own stem - keep as is
              return clip
            }
            // External stem - clone to own PDS
            const clonedRef = await cloneStem(agent, clip.ref.uri)
            return { ...clip, ref: clonedRef }
          }

          // Case 3: URL clips (http/https) and project clips pass through unchanged
          return clip
        }),
      ),
      audioPipeline: track.audioPipeline,
      visualPipeline: track.visualPipeline,
    })),
  )

  // Build and validate project record
  const canvas = project.canvas as Canvas
  const record = v.parse(absoluteWireValidators.main, {
    type: 'absolute',
    schemaVersion: 1,
    title: project.title,
    canvas: {
      width: canvas.width,
      height: canvas.height,
    },
    mediaTracks,
    metadataTracks: project.metadataTracks,
    createdAt: project.createdAt,
  } satisfies AbsoluteProject)

  log('creating project record', record)

  const response = await agent.com.atproto.repo.createRecord({
    repo: agent.assertDid,
    collection: 'dj.eddy.absolute',
    record: {
      $type: 'dj.eddy.absolute',
      ...record,
    },
  })

  return {
    uri: response.data.uri,
    cid: response.data.cid,
  }
}
