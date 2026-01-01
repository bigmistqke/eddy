import { createStore, produce } from 'solid-js/store'
import type {
  Project,
  Track,
  Clip,
  AudioEffect,
  LocalTrackState,
} from './types'

export interface ProjectStore {
  project: Project
  local: {
    tracks: Record<string, LocalTrackState>
  }
}

function createDefaultProject(): Project {
  return {
    schemaVersion: 1,
    title: 'Untitled Project',
    canvas: {
      width: 640,
      height: 360,
    },
    groups: [
      {
        type: 'grid',
        id: 'main-grid',
        columns: 2,
        rows: 2,
        members: [
          { id: 'track-0', column: 1, row: 1 },
          { id: 'track-1', column: 2, row: 1 },
          { id: 'track-2', column: 1, row: 2 },
          { id: 'track-3', column: 2, row: 2 },
        ],
      },
    ],
    tracks: [
      {
        id: 'track-0',
        name: 'Track 1',
        clips: [],
        audioPipeline: [
          { type: 'audio.gain', value: { value: 1 } },
          { type: 'audio.pan', value: { value: 0.5 } },
        ],
      },
      {
        id: 'track-1',
        name: 'Track 2',
        clips: [],
        audioPipeline: [
          { type: 'audio.gain', value: { value: 1 } },
          { type: 'audio.pan', value: { value: 0.5 } },
        ],
      },
      {
        id: 'track-2',
        name: 'Track 3',
        clips: [],
        audioPipeline: [
          { type: 'audio.gain', value: { value: 1 } },
          { type: 'audio.pan', value: { value: 0.5 } },
        ],
      },
      {
        id: 'track-3',
        name: 'Track 4',
        clips: [],
        audioPipeline: [
          { type: 'audio.gain', value: { value: 1 } },
          { type: 'audio.pan', value: { value: 0.5 } },
        ],
      },
    ],
    createdAt: new Date().toISOString(),
  }
}

export function createProjectStore() {
  const [store, setStore] = createStore<ProjectStore>({
    project: createDefaultProject(),
    local: {
      tracks: {},
    },
  })

  const actions = {
    setTitle(title: string) {
      setStore('project', 'title', title)
      setStore('project', 'updatedAt', new Date().toISOString())
    },

    setTrackGain(trackId: string, value: number) {
      setStore(
        'project',
        'tracks',
        (t) => t.id === trackId,
        'audioPipeline',
        (e: AudioEffect) => e.type === 'audio.gain',
        'value',
        'value',
        value
      )
    },

    setTrackPan(trackId: string, value: number) {
      // Pan in lexicon is 0-1 (0=left, 0.5=center, 1=right)
      setStore(
        'project',
        'tracks',
        (t) => t.id === trackId,
        'audioPipeline',
        (e: AudioEffect) => e.type === 'audio.pan',
        'value',
        'value',
        value
      )
    },

    addRecording(trackIndex: number, blob: Blob, duration: number) {
      const trackId = `track-${trackIndex}`
      const clipId = `clip-${trackIndex}-${Date.now()}`

      // Add clip to track
      setStore(
        'project',
        'tracks',
        (t) => t.id === trackId,
        produce((track: Track) => {
          track.clips = [
            {
              id: clipId,
              offset: 0,
              duration: Math.round(duration),
            },
          ]
        })
      )

      // Store local blob reference
      setStore('local', 'tracks', trackId, {
        localBlob: blob,
        localDuration: duration,
      })

      setStore('project', 'updatedAt', new Date().toISOString())
    },

    clearTrack(trackIndex: number) {
      const trackId = `track-${trackIndex}`

      setStore(
        'project',
        'tracks',
        (t) => t.id === trackId,
        produce((track: Track) => {
          track.clips = []
          track.stem = undefined
        })
      )

      setStore('local', 'tracks', trackId, undefined!)
      setStore('project', 'updatedAt', new Date().toISOString())
    },

    getTrackBlob(trackIndex: number): Blob | undefined {
      const trackId = `track-${trackIndex}`
      return store.local.tracks[trackId]?.localBlob
    },

    getTrackDuration(trackIndex: number): number | undefined {
      const trackId = `track-${trackIndex}`
      return store.local.tracks[trackId]?.localDuration
    },

    hasRecording(trackIndex: number): boolean {
      const trackId = `track-${trackIndex}`
      const track = store.project.tracks.find((t) => t.id === trackId)
      return (track?.clips.length ?? 0) > 0
    },

    getTrackGain(trackIndex: number): number {
      const trackId = `track-${trackIndex}`
      const track = store.project.tracks.find((t) => t.id === trackId)
      const gainEffect = track?.audioPipeline?.find(
        (e) => e.type === 'audio.gain'
      )
      return gainEffect?.value.value ?? 1
    },

    getTrackPan(trackIndex: number): number {
      const trackId = `track-${trackIndex}`
      const track = store.project.tracks.find((t) => t.id === trackId)
      const panEffect = track?.audioPipeline?.find((e) => e.type === 'audio.pan')
      return panEffect?.value.value ?? 0.5
    },

    // Get project ready for publishing (without local state)
    getProjectForPublish(): Project {
      return { ...store.project }
    },
  }

  return { store, ...actions }
}

export type ProjectStoreActions = ReturnType<typeof createProjectStore>
