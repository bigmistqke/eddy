import { $MESSENGER, rpc, transfer } from '@bigmistqke/rpc/messenger'
import { every, whenEffect, whenMemo } from '@bigmistqke/solid-whenever'
import type { Agent } from '@eddy/atproto'
import { getProjectByRkey, publishProject, streamStemToOPFS } from '@eddy/atproto'
import {
  decodeClipAudio,
  extractAudioChunk,
  makeOfflineAudioMixer,
  resumeAudioContext,
} from '@eddy/audio'
import type {
  AbsoluteClip,
  AbsoluteProject,
  AudioEffect,
  ClipSource,
  ClipSourceStem,
  MediaTrackAbsolute,
} from '@eddy/lexicons'
import { makeMuxer } from '@eddy/media'
import { action, createResourceMap, deepResource, defer, hold, resource } from '@eddy/solid'
import { getActiveMediaClips, getProjectDuration } from '@eddy/timeline'
import { assertedNotNullish, debug } from '@eddy/utils'
import type { EffectValue } from '@eddy/video'
import { createEffect, createSelector, createSignal, mapArray, type Accessor } from 'solid-js'
import { createStore } from 'solid-js/store'
import { createWritableStream, readClipBlob, writeBlob } from '~/opfs'
import { makeDebugInfo as initDebugInfo } from '~/primitives/make-debug-info'
import { SCHEDULER_BUFFER } from '~/primitives/make-scheduler'
import type { CaptureWorkerMethods } from '~/workers/capture.worker'
import CaptureWorker from '~/workers/capture.worker?worker'
import type { MuxerWorkerMethods } from '~/workers/muxer.worker'
import MuxerWorker from '~/workers/muxer.worker?worker'
import { makePlayer } from './make-player'

const log = debug('create-editor', false)

// Cache for clip ArrayBuffers (converted from Blobs)
const clipBufferCache = new Map<string, ArrayBuffer>()

/** Check if a clip source is a stem reference */
function isStemSource(source: ClipSource | undefined): source is ClipSourceStem {
  return source?.type === 'stem'
}

// Local state extensions (not persisted to PDS)
interface LocalClipState {
  blob?: Blob
  duration?: number
}

function makeDefaultProject(): AbsoluteProject {
  return {
    title: 'Untitled Project',
    canvas: {
      width: 640,
      height: 360,
    },
    mediaTracks: [
      {
        id: 'track-0',
        name: 'Track 1',
        clips: [],
        audioPipeline: {
          effects: [
            { type: 'audio.gain', params: { value: { value: 100 } } },
            { type: 'audio.pan', params: { value: { value: 50 } } },
          ],
        },
        visualPipeline: {
          effects: [
            { type: 'visual.brightness', params: { value: { value: 50 } } },
            {
              type: 'visual.colorize',
              params: { color: { value: [100, 80, 60] }, intensity: { value: 50 } },
            },
          ],
        },
      },
      {
        id: 'track-1',
        name: 'Track 2',
        clips: [],
        audioPipeline: {
          effects: [
            { type: 'audio.gain', params: { value: { value: 100 } } },
            { type: 'audio.pan', params: { value: { value: 50 } } },
          ],
        },
        visualPipeline: {
          effects: [
            { type: 'visual.brightness', params: { value: { value: 0 } } },
            {
              type: 'visual.colorize',
              params: { color: { value: [100, 80, 60] }, intensity: { value: 50 } },
            },
          ],
        },
      },
      {
        id: 'track-2',
        name: 'Track 3',
        clips: [],
        audioPipeline: {
          effects: [
            { type: 'audio.gain', params: { value: { value: 100 } } },
            { type: 'audio.pan', params: { value: { value: 50 } } },
          ],
        },
        visualPipeline: {
          effects: [{ type: 'visual.brightness', params: { value: { value: 0 } } }],
        },
      },
      {
        id: 'track-3',
        name: 'Track 4',
        clips: [],
        audioPipeline: {
          effects: [
            { type: 'audio.gain', params: { value: { value: 100 } } },
            { type: 'audio.pan', params: { value: { value: 50 } } },
          ],
        },
        visualPipeline: {
          effects: [{ type: 'visual.brightness', params: { value: { value: 0 } } }],
        },
      },
    ],
    metadataTracks: [
      {
        id: 'layout-track',
        name: 'Layout',
        clips: [
          {
            id: 'default-layout',
            start: 0,
            source: {
              type: 'layout',
              mode: 'grid',
              columns: 2,
              rows: 2,
              slots: ['track-0', 'track-1', 'track-2', 'track-3'],
            },
          },
        ],
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

export interface CreateEditorOptions {
  agent: Accessor<Agent | null>
  canvas: Accessor<HTMLCanvasElement | undefined>
  handle?: string
  rkey?: string
}

export function createEditor(options: CreateEditorOptions) {
  // Project store - synced from remote when rkey provided, editable locally
  const [project, { mutate: setProject }] = deepResource(
    every(
      () => options.agent(),
      () => options.rkey,
    ),
    ([agent, rkey]) =>
      getProjectByRkey(agent, rkey, options.handle).then(projectRecord => projectRecord.value),
    {
      initialValue: makeDefaultProject(),
    },
  )

  // Create player as a resource (waits for canvas to be available)
  const [player] = resource(
    every(
      () => options.canvas(),
      () => project().canvas.width,
      () => project().canvas.height,
    ),
    async ([canvas, width, height], { onCleanup }) => {
      const result = await makePlayer({
        canvas,
        width,
        height,
        project,
        schedulerBuffer: SCHEDULER_BUFFER,
      })
      initDebugInfo(result)

      onCleanup(() => {
        result.destroy()
        previewAction.clear()
      })

      return result
    },
  )

  // Pre-initialize capture and muxer workers
  const [workers] = resource(async ({ onCleanup }) => {
    log('creating workers...')
    const captureWorker = new CaptureWorker()
    const muxerWorker = new MuxerWorker()

    const captureWorkerRpc = rpc<CaptureWorkerMethods>(captureWorker)
    const muxerWorkerRpc = rpc<MuxerWorkerMethods>(muxerWorker)

    onCleanup(() => {
      captureWorkerRpc[$MESSENGER].terminate()
      muxerWorkerRpc[$MESSENGER].terminate()
    })

    // Pass scheduler buffer to muxer for backpressure signaling
    muxerWorkerRpc.setSchedulerBuffer(SCHEDULER_BUFFER)

    // Create MessageChannel to connect capture → muxer
    const channel = new MessageChannel()

    // Set up capture port on muxer
    await muxerWorkerRpc.setCapturePort(transfer(channel.port2))

    // Initialize capture with muxer port, returns capture methods
    const capture = await captureWorkerRpc.init(transfer(channel.port1))

    // Initialize muxer (VP9 + Opus encoders), returns muxer methods
    const muxer = await muxerWorkerRpc.init()

    log('workers ready')

    return { capture, muxer }
  })

  const [localClips, setLocalClips] = createStore<Record<string, LocalClipState>>({})
  const [selectedTrackId, setSelectedTrackId] = createSignal<string | null>(null)
  const [masterVolume, setMasterVolume] = createSignal(1)

  const isSelectedTrack = createSelector(selectedTrackId)
  const isRecording = () => recordAction.pending()

  // Resource map for stem clips - streams from atproto directly to OPFS
  // Returns true when clip is ready in OPFS, null on failure
  const stemClips = createResourceMap(
    // Derive clips that have stem sources from project store (flatten from tracks)
    () =>
      project()
        .mediaTracks.flatMap(track => track.clips)
        .filter((clip): clip is typeof clip & { source: ClipSourceStem } =>
          isStemSource(clip.source),
        )
        .map(clip => [clip.id, clip] as const),
    async (clipId, clip) => {
      const agent = options.agent()
      if (!agent) return null

      try {
        // Stream directly from ATProto to OPFS (avoids loading blob into memory)
        await streamStemToOPFS(agent, clip.source.ref.uri, clipId, createWritableStream)
        return true
      } catch (err) {
        console.error(`Failed to fetch stem for clip ${clipId}:`, err)
        return null
      }
    },
  )

  // Derived state
  const hasAnyRecording = whenMemo(
    player,
    _player => {
      for (const track of project().mediaTracks) {
        if (_player.hasClipForTrack(track.id)) return true
      }
      return false
    },
    () => false,
  )

  function setEffectValue(trackId: string, effectIndex: number, value: number) {
    setProject(
      'mediaTracks',
      t => t.id === trackId,
      'audioPipeline',
      'effects',
      effectIndex,
      effect => {
        if (
          'params' in effect &&
          effect.params &&
          'value' in effect.params &&
          effect.params.value &&
          'value' in effect.params.value
        ) {
          return {
            ...effect,
            params: {
              ...effect.params,
              value: { ...effect.params.value, value: Math.round(value * 100) },
            },
          }
        }
        return effect
      },
    )
  }

  function getEffectValue(trackId: string, effectIndex: number): number {
    const track = project().mediaTracks.find(t => t.id === trackId)
    const effect = track?.audioPipeline?.effects?.[effectIndex]
    if (
      effect &&
      'params' in effect &&
      effect.params &&
      'value' in effect.params &&
      effect.params.value &&
      'value' in effect.params.value
    ) {
      return effect.params.value.value / 100
    }
    return 1
  }

  function getTrackPipeline(trackId: string): AudioEffect[] {
    const track = project().mediaTracks.find(t => t.id === trackId)
    return track?.audioPipeline?.effects ?? []
  }

  // Video effect helpers (parallel to audio effects)
  function setVideoEffectValue(trackId: string, effectIndex: number, value: number) {
    // Update store
    setProject(
      'mediaTracks',
      t => t.id === trackId,
      'visualPipeline',
      'effects',
      effectIndex,
      effect => {
        if (
          effect &&
          'params' in effect &&
          effect.params &&
          'value' in effect.params &&
          effect.params.value &&
          'value' in effect.params.value
        ) {
          return {
            ...effect,
            params: { ...effect.params, value: { ...effect.params.value, value } },
          }
        }
        return effect
      },
    )

    // Update compositor directly for immediate feedback (single-value effects use 'value' paramKey)
    player()?.compositor.setEffectValue('track', trackId, effectIndex, 'value', value)
  }

  function getVideoEffectValue(trackId: string, effectIndex: number): number {
    const track = project().mediaTracks.find(t => t.id === trackId)
    const effect = track?.visualPipeline?.effects?.[effectIndex]
    if (
      effect &&
      'params' in effect &&
      effect.params &&
      'value' in effect.params &&
      effect.params.value &&
      'value' in effect.params.value
    ) {
      return effect.params.value.value
    }
    return 0
  }

  /** Set a specific param value for a video effect (supports scalar and vector values) */
  function setVideoEffectParam(
    trackId: string,
    effectIndex: number,
    paramKey: string,
    value: EffectValue,
  ) {
    // Update store
    setProject(
      'mediaTracks',
      t => t.id === trackId,
      'visualPipeline',
      'effects',
      effectIndex,
      effect => {
        if (!effect || !('params' in effect) || !effect.params) return effect
        const params = effect.params as Record<string, { value: number | number[] }>
        if (!(paramKey in params)) return effect
        return {
          ...effect,
          params: { ...params, [paramKey]: { ...params[paramKey], value } },
        }
      },
    )

    // Update compositor directly for immediate feedback
    player()?.compositor.setEffectValue('track', trackId, effectIndex, paramKey, value)
  }

  function getVisualPipeline(trackId: string) {
    const track = project().mediaTracks.find(t => t.id === trackId)
    return track?.visualPipeline?.effects ?? []
  }

  function addRecording(trackId: string, clipId: string, duration: number, startMs: number) {
    // Track that this clip exists locally (blob is stored in OPFS)
    setLocalClips(clipId, { duration })

    // Create the clip
    const newClip: AbsoluteClip = {
      id: clipId,
      start: Math.round(startMs),
      duration: Math.round(duration),
    }

    // Add clip to track.clips (inline)
    setProject(
      'mediaTracks',
      track => track.id === trackId,
      'clips',
      clips => [...clips, newClip],
    )

    setProject('updatedAt', new Date().toISOString())
  }

  function clearTrack(trackId: string) {
    const track = project().mediaTracks.find(t => t.id === trackId)

    if (track) {
      // Clear local state for each clip
      for (const clip of track.clips) {
        setLocalClips(clip.id, undefined!)
      }
    }

    // Clear clips on the track
    setProject(
      'mediaTracks',
      t => t.id === trackId,
      'clips',
      [],
    )

    setProject('updatedAt', new Date().toISOString())
  }

  /** Find the clip at a given time (in seconds) on a track */
  function getClipAtTime(trackId: string, timeSeconds: number): AbsoluteClip | undefined {
    const track = project().mediaTracks.find(t => t.id === trackId)
    if (!track) return undefined

    const timeMs = timeSeconds * 1000 // Convert to ms (clips use ms)
    return track.clips.find(
      clip => clip.start <= timeMs && timeMs < clip.start + (clip.duration ?? Infinity),
    )
  }

  /** Remove a single clip from a track */
  function removeClip(trackId: string, clipId: string) {
    // Clean up local blob reference
    setLocalClips(clipId, undefined!)

    // Remove clip from track.clips (inline)
    setProject(
      'mediaTracks',
      t => t.id === trackId,
      'clips',
      clips => clips.filter(clip => clip.id !== clipId),
    )

    setProject('updatedAt', new Date().toISOString())
  }

  // Check if a clip is ready in OPFS (either local recording or fetched stem)
  function isClipReady(clipId: string): boolean {
    // Local recordings are tracked in localClips store
    if (localClips[clipId]) return true
    // Stems are ready when stemClips returns true (meaning written to OPFS)
    return stemClips.get(clipId) === true
  }

  // Helper to get blob by clipId (all clips are stored in OPFS)
  async function getClipBlob(clipId: string): Promise<Blob | undefined> {
    const blob = await readClipBlob(clipId)
    return blob ?? undefined
  }

  // Helper to get ArrayBuffer by clipId (for export)
  // Caches converted buffers for efficiency
  async function getClipBuffer(clipId: string): Promise<ArrayBuffer | undefined> {
    // Check cache first
    const cached = clipBufferCache.get(clipId)
    if (cached) return cached

    const blob = await getClipBlob(clipId)
    if (!blob) return undefined

    // Convert and cache
    const buffer = await blob.arrayBuffer()
    clipBufferCache.set(clipId, buffer)
    return buffer
  }

  // Synchronous version that returns cached buffer or undefined
  function getClipBufferSync(clipId: string): ArrayBuffer | undefined {
    return clipBufferCache.get(clipId)
  }

  // Preview action - requests media access and sets up preview stream
  const previewAction = action(async (trackId: string, { onCleanup }) => {
    await resumeAudioContext()
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: { facingMode: 'user' },
    })
    player()?.setPreviewSource(trackId, stream)

    onCleanup(() => {
      stream.getTracks().forEach(t => t.stop())
      player()?.setPreviewSource(trackId, null)
    })

    return stream
  })

  const recordAction = action(function* (trackId: string, { onCleanup }) {
    log('record', { trackId })

    const _workers = assertedNotNullish(workers(), 'Workers not ready')
    const _player = assertedNotNullish(player(), 'No player available')
    const stream = assertedNotNullish(
      previewAction.latest(),
      'Cannot start recording without media stream',
    )

    // Capture timeline offset (in ms) before recording starts
    const timelineOffset = _player.time() * 1000

    // Get video track and create processor
    const videoTrack = assertedNotNullish(stream.getVideoTracks()[0], 'No video track')
    const videoProcessor = new MediaStreamTrackProcessor({ track: videoTrack })

    // Get audio track and create processor (if available)
    const [audioTrack] = stream.getAudioTracks()
    const audioProcessor = audioTrack ? new MediaStreamTrackProcessor({ track: audioTrack }) : null

    // Start capture (runs until cancelled)
    const startTime = performance.now()
    const capturePromise = _workers.capture
      .start(
        transfer(videoProcessor.readable),
        audioProcessor ? transfer(audioProcessor.readable) : undefined,
      )
      .catch((err: unknown) => log('capture error:', err))

    onCleanup(async () => {
      log('stopping capture...')
      await capturePromise
      await _workers.capture.stop()
    })

    // Route playback audio through MediaStream output during recording.
    // Avoids Chrome bug where AudioContext.destination interferes with getUserMedia capture.
    _player.useMasterMediaStreamOutput()
    onCleanup(() => _player.useMasterDirectOutput())

    // Mute the track being recorded to (so existing clips don't play audio)
    // The new recording's audio comes from the capture stream, not this pipeline
    _player.setVolume(trackId, 0)
    onCleanup(() => _player.setVolume(trackId, 1))

    // Start playback from current position (not 0)
    yield* defer(_player.play(timelineOffset / 1000))

    log('recording started', { timelineOffset })

    // Hold until cancelled, then return recording info for finalization
    return hold(() => ({ trackId, startTime, timelineOffset }))
  })

  // Finalize recording and add to track
  const finalizeRecordingAction = action(
    async ({
      trackId,
      startTime,
      timelineOffset,
    }: {
      trackId: string
      startTime: number
      timelineOffset: number
    }) => {
      const _workers = assertedNotNullish(workers(), 'Workers not ready')

      // Generate clipId before finalize (muxer writes to OPFS using this ID)
      const clipId = `clip-${trackId}-${Date.now()}`

      log('finalizing recording...', { clipId })
      const result = await _workers.muxer.finalize(clipId)
      const duration = performance.now() - startTime

      if (result.frameCount > 0) {
        log('recording finalized', {
          clipId: result.clipId,
          frameCount: result.frameCount,
          duration,
          timelineOffset,
        })

        addRecording(trackId, clipId, duration, timelineOffset)
      }

      // Reset muxer for next recording
      await _workers.muxer.reset()

      await player()?.stop()

      return result
    },
  )

  // Publish action - uploads clips and publishes project
  const publishAction = action(async () => {
    const currentAgent = options.agent()
    if (!currentAgent) {
      throw new Error('Please sign in to publish')
    }

    const _project = project()
    const clipBlobs = new Map<string, { blob: Blob; duration: number }>()

    // Flatten all clips from mediaTracks
    const allClips = _project.mediaTracks.flatMap(track => track.clips)

    for (const clip of allClips) {
      // Skip clips that already have a stem source - they don't need to be re-uploaded
      if (clip.source?.type === 'stem') continue

      const blob = await getClipBlob(clip.id)
      const duration = clip.duration
      if (blob && duration) {
        clipBlobs.set(clip.id, { blob, duration })
      }
    }

    // Check if there's anything to publish (either new recordings or existing stems)
    const hasNewRecordings = clipBlobs.size > 0
    const hasExistingStems = allClips.some(clip => clip.source?.type === 'stem')

    if (!hasNewRecordings && !hasExistingStems) {
      throw new Error('No recordings to publish')
    }

    const result = await publishProject(currentAgent, _project, clipBlobs)
    return result.uri.split('/').pop()
  })

  // Load clips into player - each track has its own effect for fine-grained reactivity
  whenEffect(player, _player => {
    createEffect(
      mapArray(
        () => project().mediaTracks.map(t => t.id),
        trackId => {
          // Track the current clip ID to detect changes
          let currentClipId: string | null = null

          // Effect for loading/clearing clips
          createEffect(() => {
            // Access track by ID and get first clip
            const _project = project()
            const track = _project.mediaTracks.find(t => t.id === trackId)
            const clip = track?.clips[0]
            const newClipId = clip?.id ?? null

            // Clip changed - clear old one first
            if (newClipId !== currentClipId) {
              if (_player.hasClip(trackId)) {
                log('clearing old clip from player', { trackId, oldClipId: currentClipId })
                _player.clearClip(trackId)
              }
              currentClipId = newClipId
            }

            // Load new clip if available and ready in OPFS
            if (
              clip &&
              isClipReady(clip.id) &&
              !_player.hasClipForTrack(trackId) &&
              !_player.isLoadingForTrack(trackId)
            ) {
              log('loading clip into player', { trackId, clipId: clip.id })
              _player.loadClip(trackId, clip.id).catch(err => {
                console.error(`Failed to load clip for track ${trackId}:`, err)
              })
            }
          })

          // Effect for audio volume/pan
          createEffect(() => {
            const pipeline = getTrackPipeline(trackId)

            for (let j = 0; j < pipeline.length; j++) {
              const effect = pipeline[j]
              const value = getEffectValue(trackId, j)

              if (effect.type === 'audio.gain') {
                _player.setVolume(trackId, value)
              } else if (effect.type === 'audio.pan') {
                _player.setPan(trackId, (value - 0.5) * 2)
              }
            }
          })

          // Effect for video pipeline - send values to compositor
          createEffect(() => {
            const pipeline = getVisualPipeline(trackId)

            // Send each effect param's value to compositor
            for (let effectIndex = 0; effectIndex < pipeline.length; effectIndex++) {
              const effect = pipeline[effectIndex]
              if (!('params' in effect) || !effect.params) continue

              // Iterate over all params in the effect
              for (const [paramKey, paramValue] of Object.entries(effect.params)) {
                if (paramValue && typeof paramValue === 'object' && 'value' in paramValue) {
                  _player.compositor.setEffectValue(
                    'track',
                    trackId,
                    effectIndex,
                    paramKey,
                    paramValue.value,
                  )
                }
              }
            }
          })
        },
      ),
    )
  })

  createEffect(() => {
    const _player = player()
    if (_player) _player.setMasterVolume(masterVolume())
  })

  /** Trigger download of a blob */
  function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  // Export action using phased action pattern
  const exportAction = action
    .phase('preparing', async (_, { onCleanup }) => {
      const _player = assertedNotNullish(player(), 'No player available')
      const _project = project()
      const duration = getProjectDuration(_project) / 1000 // Convert to seconds

      if (duration <= 0) {
        throw new Error('No content to export')
      }

      // Pause playback and stop render loop during export
      _player.pause()
      _player.stopRenderLoop()

      // Restart render loop when export completes or is cancelled
      onCleanup(() => _player.startRenderLoop())

      return { player: _player, project: _project, duration }
    })
    .phase('audio', async ({ project: _project, duration }, { setProgress }) => {
      log('export: preparing audio')
      const sampleRate = 48000
      const audioMixer = makeOfflineAudioMixer(duration, sampleRate)
      let hasAudio = false
      let clipIndex = 0
      const totalClips = _project.mediaTracks.reduce((sum, t) => sum + t.clips.length, 0)

      // Decode and mix audio from all clips
      for (const track of _project.mediaTracks) {
        const effects = track.audioPipeline?.effects ?? []

        for (const clip of track.clips) {
          const buffer = await getClipBuffer(clip.id)
          if (buffer) {
            const audioBuffer = await decodeClipAudio(buffer, sampleRate)
            if (audioBuffer) {
              hasAudio = true
              const startTime = clip.start / 1000
              audioMixer.addTrack({ buffer: audioBuffer, effects, startTime })
            }
          }
          clipIndex++
          setProgress(clipIndex / totalClips)
        }
      }

      // Render mixed audio
      const renderedAudio = hasAudio ? await audioMixer.render() : null
      log('export: audio ready', { hasAudio })

      return { renderedAudio, sampleRate }
    })
    .phase('video', async ({ renderedAudio, sampleRate }, { setProgress, signal }) => {
      const _player = assertedNotNullish(player(), 'No player available')
      const _project = project()
      const duration = getProjectDuration(_project) / 1000 // Convert to seconds
      const frameRate = 30
      const frameDuration = 1 / frameRate
      const totalFrames = Math.ceil(duration * frameRate)
      const samplesPerFrame = Math.floor(sampleRate / frameRate)

      log('export: rendering video', { totalFrames, duration })

      // Initialize muxer
      const muxer = makeMuxer({
        videoBitrate: 2_000_000,
        audioBitrate: 128_000,
        audio: true,
        video: true,
      })
      await muxer.init()

      // Render frame by frame
      for (let frameIndex = 0; frameIndex < totalFrames; frameIndex++) {
        if (signal.aborted) break

        const time = frameIndex * frameDuration

        // Get active clips from project at this time (time in seconds, convert to ms)
        const activeClips = getActiveMediaClips(_project, time * 1000)

        // Fetch frames directly from each clip's playback worker
        const frameEntries: Array<{ clipId: string; frame: VideoFrame }> = []
        for (const { clip, sourceTime } of activeClips) {
          const frame = await _player.getClipFrameAtTime(clip.id, sourceTime) // sourceTime is already in seconds
          if (frame) {
            frameEntries.push({ clipId: clip.id, frame })
          }
        }

        // Render all frames and capture
        const videoFrame = await _player.compositor.renderFramesAndCapture(time, frameEntries)

        if (videoFrame) {
          // Copy VideoFrame data for muxer
          const format = (videoFrame.format ?? 'RGBA') as VideoPixelFormat
          const codedWidth = videoFrame.displayWidth
          const codedHeight = videoFrame.displayHeight
          const size = videoFrame.allocationSize()
          const buffer = new ArrayBuffer(size)
          await videoFrame.copyTo(buffer)

          muxer.addVideoFrame({ buffer, format, codedWidth, codedHeight, timestamp: time })
          videoFrame.close()
        } else {
          console.log('no videoFrame!')
        }

        // Add audio chunk for this frame
        if (renderedAudio) {
          const startSample = frameIndex * samplesPerFrame
          const endSample = (frameIndex + 1) * samplesPerFrame
          const audioChunk = extractAudioChunk(renderedAudio, startSample, endSample)

          if (audioChunk[0]?.length > 0) {
            muxer.addAudioFrame({ data: audioChunk, sampleRate, timestamp: time })
          }
        }

        setProgress((frameIndex + 1) / totalFrames)
      }

      return { muxer }
    })
    .phase('finalizing', async ({ muxer }) => {
      log('export: finalizing')
      const result = await muxer.finalize()

      log('export: complete', {
        fileSize: result.blob.size,
        videoFrames: result.videoFrameCount,
        audioFrames: result.audioFrameCount,
      })

      // Download the file
      downloadBlob(result.blob, `export-${Date.now()}.webm`)

      return result
    })

  return {
    canPublish() {
      return (
        !isRecording() &&
        !player()?.isPlaying() &&
        !publishAction.pending() &&
        hasAnyRecording() &&
        !!options.agent()
      )
    },
    getEffectValue,
    getTrackPipeline,
    getVideoEffectValue,
    getVisualPipeline,
    hasAnyRecording,
    isPlayerLoading: () => player.loading,
    isProjectLoading: () => project.loading || stemClips.loading(),
    isPublishing: publishAction.pending,
    isRecording,
    isSelectedTrack,
    loopEnabled: () => player()?.loop() ?? false,
    masterVolume,
    player,
    previewPending: previewAction.pending,
    publishError: publishAction.error,
    selectedTrack: selectedTrackId,
    setMasterVolume,
    // Project store actions
    setTitle(title: string) {
      setProject('title', title)
      setProject('updatedAt', new Date().toISOString())
    },
    finalizingRecording: finalizeRecordingAction.pending,
    project: project,

    publish() {
      return publishAction()
    },

    async stop() {
      await player()?.stop()
    },

    selectTrack(trackId: string) {
      log('selectTrack', { trackId })
      const _player = player()

      if (isSelectedTrack(trackId)) {
        previewAction.clear()
        setSelectedTrackId(null)
        return
      }

      if (isRecording()) return

      previewAction.clear()

      if (_player && !_player.hasClip(trackId)) {
        setSelectedTrackId(trackId)
        previewAction.try(trackId)
      }
    },

    async toggleRecording() {
      const trackId = selectedTrackId()
      if (trackId === null) return
      if (finalizeRecordingAction.pending()) return

      if (isRecording()) {
        // Stop recording - cancel triggers hold to resolve
        recordAction.cancel()

        // Await the result
        const result = await recordAction.promise()

        previewAction.clear()
        setSelectedTrackId(null)

        if (result) {
          await finalizeRecordingAction(result)
        }
      } else {
        recordAction.try(trackId)
      }
    },

    async playPause() {
      const _player = player()
      if (!_player) return

      if (selectedTrackId() !== null && !isRecording()) {
        previewAction.clear()
        setSelectedTrackId(null)
      }

      await resumeAudioContext()

      if (_player.isPlaying()) {
        _player.pause()
      } else {
        await _player.play()
      }
    },

    clearRecording(trackId: string) {
      const _player = player()
      const currentTime = _player?.time() ?? 0
      const clip = getClipAtTime(trackId, currentTime)

      if (!clip) {
        console.warn('No clip found at current time for track', trackId)
        return
      }

      removeClip(trackId, clip.id)
      _player?.clearClip(clip.id)
    },

    setTrackVolume(trackId: string, value: number) {
      const pipeline = getTrackPipeline(trackId)
      const gainIndex = pipeline.findIndex(e => e.type === 'audio.gain')
      if (gainIndex !== -1) {
        setEffectValue(trackId, gainIndex, value)
      }
      player()?.setVolume(trackId, value)
    },

    setTrackPan(trackId: string, value: number) {
      const pipeline = getTrackPipeline(trackId)
      const panIndex = pipeline.findIndex(e => e.type === 'audio.pan')
      if (panIndex !== -1) {
        setEffectValue(trackId, panIndex, (value + 1) / 2)
      }
      player()?.setPan(trackId, value)
    },

    setVideoEffectValue,
    setVideoEffectParam,

    toggleLoop() {
      const _player = player()
      if (_player) {
        _player.setLoop(!_player.loop())
      }
    },

    async downloadClip(trackId: string) {
      const _player = player()
      const currentTime = _player?.time() ?? 0
      const clip = getClipAtTime(trackId, currentTime)

      if (!clip) {
        console.warn('No clip found at current time for track', trackId)
        return
      }

      const blob = await getClipBlob(clip.id)
      if (!blob) {
        console.warn('No blob found for clip', clip.id)
        return
      }

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${trackId}-${clip.id}.webm`
      link.click()
      URL.revokeObjectURL(url)
    },

    /** Load a test clip into a track (for perf testing) */
    async loadTestClip(trackId: string, blob: Blob, duration: number, offset = 0) {
      const clipId = `clip-${trackId}-${Date.now()}`
      await writeBlob(clipId, blob)
      addRecording(trackId, clipId, duration, offset)
    },

    // Export
    /** Start export and download result */
    async export() {
      return exportAction()
    },
    /** Cancel ongoing export */
    cancelExport: exportAction.cancel,
    /** Export progress within current phase (0-1) */
    exportProgress: exportAction.progress,
    /** Current export phase */
    exportPhase: exportAction.phase,
    /** Whether export is in progress */
    isExporting: exportAction.pending,
    /** Export error if any */
    exportError: exportAction.error,
  }
}

export type Editor = ReturnType<typeof createEditor>
