import { action, useAction, useSubmission } from "@solidjs/router";
import { FiCircle, FiPause, FiPlay, FiSquare } from "solid-icons/fi";
import {
  type Component,
  createSignal,
  For,
  onCleanup,
  onMount,
} from "solid-js";
import { resumeAudioContext } from "~/lib/audio/context";
import {
  createRecorder,
  type RecordingResult,
  requestMediaAccess,
} from "~/lib/audio/recorder";
import { type Compositor, createCompositor } from "~/lib/video/compositor";
import styles from "./Editor.module.css";
import { Track } from "./Track";

interface EditorProps {
  projectId?: string;
}

const TRACK_IDS = [0, 1, 2, 3] as const;

const startPreviewAction = action(async () => {
  await resumeAudioContext();
  return await requestMediaAccess(true);
});

const stopRecordingAction = action(
  async (recorderInstance: ReturnType<typeof createRecorder>) => {
    return await recorderInstance.stop();
  },
);

export const Editor: Component<EditorProps> = () => {
  const [isPlaying, setIsPlaying] = createSignal(false);
  const [isRecording, setIsRecording] = createSignal(false);
  const [selectedTrack, setSelectedTrack] = createSignal<number | null>(null);
  const [currentTime, setCurrentTime] = createSignal<number | undefined>(
    undefined,
  );
  const [recordings, setRecordings] = createSignal<(RecordingResult | null)[]>([
    null,
    null,
    null,
    null,
  ]);

  const startPreview$ = useAction(startPreviewAction);
  const stopRecording$ = useAction(stopRecordingAction);
  const previewSubmission = useSubmission(startPreviewAction);
  const stopRecordingSubmission = useSubmission(stopRecordingAction);

  let compositorContainer: HTMLDivElement | undefined;
  let compositor: Compositor | null = null;
  let animationId: number | null = null;
  let previewVideo: HTMLVideoElement | null = null;
  let stream: MediaStream | null = null;
  let recorder: ReturnType<typeof createRecorder> | null = null;

  onMount(() => {
    compositor = createCompositor(640, 360);
    compositor.canvas.className = styles.compositorCanvas;
    if (compositorContainer) {
      compositorContainer.appendChild(compositor.canvas);
    }
    startRenderLoop();
  });

  onCleanup(() => {
    stopRenderLoop();
    stopPreview();
    compositor?.destroy();
  });

  const startRenderLoop = () => {
    const loop = () => {
      compositor?.render();
      animationId = requestAnimationFrame(loop);
    };
    loop();
  };

  const stopRenderLoop = () => {
    if (animationId) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  };

  const setupPreviewStream = (mediaStream: MediaStream, trackIndex: number) => {
    stream = mediaStream;
    previewVideo = document.createElement("video");
    previewVideo.srcObject = stream;
    previewVideo.muted = true;
    previewVideo.playsInline = true;
    previewVideo.play();
    compositor?.setVideo(trackIndex, previewVideo);
  };

  const startPreview = async (trackIndex: number) => {
    const result = await startPreview$();
    if (result) {
      setupPreviewStream(result, trackIndex);
    }
  };

  const stopPreview = () => {
    if (previewVideo) {
      previewVideo.srcObject = null;
      previewVideo = null;
    }
    stream?.getTracks().forEach((track) => {
      track.stop();
    });
    stream = null;
  };

  const handleSelectTrack = async (trackIndex: number) => {
    // If already selected, deselect
    if (selectedTrack() === trackIndex) {
      const prevTrack = selectedTrack();
      if (prevTrack !== null && !recordings()[prevTrack]) {
        compositor?.setVideo(prevTrack, null);
      }
      stopPreview();
      setSelectedTrack(null);
      return;
    }

    // If recording, can't switch tracks
    if (isRecording()) return;

    // Clear previous preview if no recording there
    const prevTrack = selectedTrack();
    if (prevTrack !== null && !recordings()[prevTrack]) {
      compositor?.setVideo(prevTrack, null);
    }
    stopPreview();

    // Start preview for new track (only if no recording exists)
    if (!recordings()[trackIndex]) {
      setSelectedTrack(trackIndex);
      await startPreview(trackIndex);
    }
  };

  const handleRecord = async () => {
    const track = selectedTrack();
    if (track === null) return;

    if (isRecording()) {
      // Stop recording and playback
      if (!recorder) {
        throw new Error("Recording state but no recorder instance");
      }
      const result = await stopRecording$(recorder);
      if (result) {
        setRecordings((prev) => {
          const next = [...prev];
          next[track] = result;
          return next;
        });
      }
      stopPreview();
      setIsRecording(false);
      setIsPlaying(false);
      setSelectedTrack(null);
    } else {
      // Start recording + play all existing clips from beginning
      if (!stream) {
        throw new Error("Cannot start recording without media stream");
      }
      recorder = createRecorder(stream);
      recorder.start();
      // Force seek by setting undefined first, then 0
      setCurrentTime(undefined);
      queueMicrotask(() => {
        setCurrentTime(0); // Reset all clips to start
        setIsRecording(true);
        setIsPlaying(true); // Play existing clips while recording
      });
    }
  };

  const handlePlayPause = async () => {
    // Stop preview when playing
    if (selectedTrack() !== null && !isRecording()) {
      const track = selectedTrack();
      if (track !== null && !recordings()[track]) {
        compositor?.setVideo(track, null);
      }
      stopPreview();
      setSelectedTrack(null);
    }

    await resumeAudioContext();
    setCurrentTime(undefined);
    setIsPlaying(!isPlaying());
  };

  const handleStop = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const handleVideoChange = (index: number, video: HTMLVideoElement | null) => {
    // Don't override preview video for selected track
    if (selectedTrack() === index && previewVideo) return;
    compositor?.setVideo(index, video);
  };

  const handleClearRecording = (index: number) => {
    setRecordings((prev) => {
      const next = [...prev];
      next[index] = null;
      return next;
    });
    compositor?.setVideo(index, null);
  };

  return (
    <div class={styles.container}>
      <div class={styles.compositorContainer} ref={compositorContainer} />
      <div class={styles.transport}>
        <button
          class={styles.playButton}
          onClick={handlePlayPause}
          disabled={isRecording() || selectedTrack() !== null}
        >
          {isPlaying() ? <FiPause size={24} /> : <FiPlay size={24} />}
        </button>
        <button
          class={styles.recordButton}
          classList={{ [styles.recording]: isRecording() }}
          onClick={handleRecord}
          disabled={
            selectedTrack() === null ||
            previewSubmission.pending ||
            stopRecordingSubmission.pending
          }
        >
          {isRecording() ? <FiSquare size={20} /> : <FiCircle size={20} />}
        </button>
        <button
          class={styles.stopButton}
          onClick={handleStop}
          disabled={isRecording() || selectedTrack() !== null}
        >
          <FiSquare size={20} />
        </button>
      </div>
      <div class={styles.grid}>
        <For each={TRACK_IDS}>
          {(id) => (
            <Track
              id={id}
              isPlaying={isPlaying()}
              isSelected={selectedTrack() === id}
              isRecording={isRecording() && selectedTrack() === id}
              isLoading={previewSubmission.pending && selectedTrack() === id}
              currentTime={currentTime()}
              recording={recordings()[id]}
              onSelect={() => handleSelectTrack(id)}
              onVideoChange={handleVideoChange}
              onClear={() => handleClearRecording(id)}
            />
          )}
        </For>
      </div>
    </div>
  );
};
