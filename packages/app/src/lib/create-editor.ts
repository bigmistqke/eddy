import type { Agent } from "@atproto/api";
import { getMasterMixer, resumeAudioContext } from "@klip/mixer";
import type { Playback } from "@klip/playback";
import { createEffect, createMemo, createSelector, createSignal, onCleanup, type Accessor } from "solid-js";
import { publishProject } from "~/lib/atproto/crud";
import {
  createPlayer
} from "~/lib/create-player";
import { createProjectStore } from "~/lib/project-store";
import { createRecorder, requestMediaAccess } from "~/lib/recorder";

export interface CreateEditorOptions {
  agent: Accessor<Agent | null>;
  container: HTMLDivElement;
  handle?: string;
  rkey?: string;
}

export function createEditor(options: CreateEditorOptions) {
  const project = createProjectStore();

  // Playback state
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [isRecording, setIsRecording] = createSignal(false);
  const [isPublishing, setIsPublishing] = createSignal(false);
  const [selectedTrack, setSelectedTrack] = createSignal<number | null>(null);
  const [currentTime, setCurrentTime] = createSignal<number | undefined>(undefined);
  const [masterVolume, setMasterVolume] = createSignal(1);

  // Preview/recording state
  const [previewPending, setPreviewPending] = createSignal(false);
  const [stopRecordingPending, setStopRecordingPending] = createSignal(false);

  const isSelectedTrack = createSelector(selectedTrack);

  const player = createMemo(() => {
    const player = createPlayer(
      project.store.project.canvas.width,
      project.store.project.canvas.height,
      { autoStart: true }
    );

    options.container.appendChild(player.canvas);

    onCleanup(() => {
      player.destroy();
      stopPreview();
      for (const frame of pendingFirstFrames.values()) {
        frame.close();
      }
      pendingFirstFrames.clear();
    });

    return player
  })

  let previewVideo: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let recorder: ReturnType<typeof createRecorder> | null = null;
  const pendingFirstFrames = new Map<number, VideoFrame>();

  // Load project if rkey provided
  createEffect((projectLoaded?: boolean) => {
    if (projectLoaded) return

    const currentAgent = options.agent();
    if (!currentAgent || !options.rkey) return

    project.loadProject(currentAgent, options.handle, options.rkey);
    return true
  });

  function setupPreviewStream(mediaStream: MediaStream, trackIndex: number) {
    stream = mediaStream;
    previewVideo = document.createElement("video");
    previewVideo.srcObject = stream;
    previewVideo.muted = true;
    previewVideo.playsInline = true;
    previewVideo.play();
    player().setSource(trackIndex, previewVideo);
  }

  async function startPreview(trackIndex: number) {
    setPreviewPending(true);
    try {
      await resumeAudioContext();
      const result = await requestMediaAccess(true);
      if (result) {
        setupPreviewStream(result, trackIndex);
      }
    } finally {
      setPreviewPending(false);
    }
  }

  function stopPreview() {
    if (previewVideo) {
      previewVideo.srcObject = null;
      previewVideo = null;
    }
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
    stream = null;
  }

  function stop() {
    setIsPlaying(false);
    setCurrentTime(0);
  }

  return {
    // Project store
    project,

    // State accessors
    isPlaying,
    isRecording,
    isPublishing,
    selectedTrack,
    currentTime,
    masterVolume,
    isSelectedTrack,
    previewPending,
    stopRecordingPending,

    // Actions
    stop,
    async selectTrack(trackIndex: number) {
      // If already selected, deselect
      if (isSelectedTrack(trackIndex)) {
        const prevTrack = selectedTrack();
        if (prevTrack !== null && !project.hasRecording(prevTrack)) {
          player().setSource(prevTrack, null);
        }
        stopPreview();
        setSelectedTrack(null);
        return;
      }

      // If recording, can't switch tracks
      if (isRecording()) {
        return;
      }

      // Clear previous preview if no recording there
      const prevTrack = selectedTrack();
      if (prevTrack !== null && !project.hasRecording(prevTrack)) {
        player().setSource(prevTrack, null);
      }
      stopPreview();

      // Start preview for new track (only if no recording exists)
      if (!project.hasRecording(trackIndex)) {
        setSelectedTrack(trackIndex);
        await startPreview(trackIndex);
      }
    },

    async record() {
      const track = selectedTrack();
      if (track === null) return;

      // Stop recording
      if (isRecording()) {
        if (!recorder) {
          throw new Error("Recording state but no recorder instance");
        }

        setStopRecordingPending(true);
        try {
          const result = await recorder.stop();

          if (result) {
            // Display first frame immediately if available
            if (result.firstFrame) {
              const existingFrame = pendingFirstFrames.get(track);
              if (existingFrame) {
                existingFrame.close();
              }
              pendingFirstFrames.set(track, result.firstFrame);
              player().setFrame(track, result.firstFrame);
            }
            project.addRecording(track, result.blob, result.duration);
          }

          stopPreview();
          setIsRecording(false);
          setIsPlaying(false);
          setSelectedTrack(null);
        } finally {
          setStopRecordingPending(false);
        }
        return;
      }

      // Start recording
      if (!stream) {
        throw new Error("Cannot start recording without media stream");
      }

      recorder = createRecorder(stream);
      recorder.start();

      // Force seek by setting undefined first, then 0
      setCurrentTime(undefined);

      queueMicrotask(() => {
        setCurrentTime(0);
        setIsRecording(true);
        setIsPlaying(true);
      });
    },
    async playPause() {
      // Stop preview when playing
      if (selectedTrack() !== null && !isRecording()) {
        const track = selectedTrack();
        if (track !== null && !project.hasRecording(track)) {
          player().setSource(track, null);
        }
        stopPreview();
        setSelectedTrack(null);
      }

      await resumeAudioContext();
      setCurrentTime(undefined);
      setIsPlaying(!isPlaying());
    },

    playerChange(index: number, playback: Playback | null) {
      // Don't override preview video for selected track
      if (selectedTrack() === index && previewVideo) return;
      if (playback) {
        const pendingFrame = pendingFirstFrames.get(index);
        if (pendingFrame) {
          pendingFrame.close();
          pendingFirstFrames.delete(index);
        }
        player().attach(index, playback);
      } else {
        player().detach(index);
      }
    },

    clearRecording(index: number) {
      const pendingFrame = pendingFirstFrames.get(index);
      if (pendingFrame) {
        pendingFrame.close();
        pendingFirstFrames.delete(index);
      }
      project.clearTrack(index);
      player().detach(index);
    },

    updateMasterVolume(value: number) {
      setMasterVolume(value);
      getMasterMixer().setMasterVolume(value);
    },

    async publish() {
      const currentAgent = options.agent();
      if (!currentAgent) {
        alert("Please sign in to publish");
        return;
      }

      // Collect clip blobs
      const clipBlobs = new Map<string, { blob: Blob; duration: number }>();
      for (const track of project.store.project.tracks) {
        for (const clip of track.clips) {
          const blob = project.getClipBlob(clip.id);
          const duration = project.getClipDuration(clip.id);
          if (blob && duration) {
            clipBlobs.set(clip.id, { blob, duration });
          }
        }
      }

      if (clipBlobs.size === 0) {
        alert("No recordings to publish");
        return;
      }

      setIsPublishing(true);
      try {
        const result = await publishProject(
          currentAgent,
          project.store.project,
          clipBlobs,
        );
        // Extract rkey from AT URI: at://did/collection/rkey
        const rkey = result.uri.split("/").pop();
        return rkey;
      } catch (error) {
        console.error("Publish failed:", error);
        alert(`Publish failed: ${error}`);
      } finally {
        setIsPublishing(false);
      }
    },

    hasAnyRecording() {
      for (let i = 0; i < 4; i++) {
        if (project.hasRecording(i)) return true;
      }
      return false;
    }
  };
}

export type Editor = ReturnType<typeof createEditor>;
