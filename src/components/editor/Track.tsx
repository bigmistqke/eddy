import {
  type Component,
  createSignal,
  createEffect,
  createMemo,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { FiTrash2 } from "solid-icons/fi";
import { createAudioPipeline, type AudioPipeline } from "~/lib/audio/pipeline";
import { useProject } from "~/lib/project/context";
import styles from "./Track.module.css";

interface TrackProps {
  id: number;
  isPlaying?: boolean;
  isSelected?: boolean;
  isRecording?: boolean;
  isLoading?: boolean;
  currentTime?: number;
  onSelect?: () => void;
  onVideoChange?: (index: number, video: HTMLVideoElement | null) => void;
  onClear?: () => void;
}

export const Track: Component<TrackProps> = (props) => {
  const project = useProject();
  const trackId = `track-${props.id}`;

  const [playbackEl, setPlaybackEl] = createSignal<HTMLVideoElement | null>(
    null,
  );

  let pipeline: AudioPipeline | null = null;

  // Derived state from project store
  const hasRecording = createMemo(() => project.hasRecording(props.id));
  const trackBlob = createMemo(() => project.getTrackBlob(props.id));
  const gain = createMemo(() => project.getTrackGain(props.id));
  const pan = createMemo(() => project.getTrackPan(props.id));

  onMount(() => {
    pipeline = createAudioPipeline();
    // Initialize pipeline with store values
    pipeline.setVolume(gain());
    // Convert 0-1 (lexicon) to -1..1 (Web Audio)
    pipeline.setPan((pan() - 0.5) * 2);
  });

  onCleanup(() => {
    pipeline?.disconnect();
    props.onVideoChange?.(props.id, null);
  });

  // React to global play/pause and seek
  createEffect(() => {
    const el = playbackEl();
    if (!el || !hasRecording()) return;

    // Seek if currentTime is specified
    if (props.currentTime !== undefined) {
      el.currentTime = props.currentTime;
    }

    if (props.isPlaying) {
      el.play().catch(() => {
        // Ignore AbortError when play is interrupted by pause
      });
    } else {
      el.pause();
    }
  });

  const handleClear = () => {
    const el = playbackEl();
    if (el) {
      el.pause();
      el.src = "";
    }
    setPlaybackEl(null);
    pipeline?.disconnect();
    props.onClear?.();
  };

  const handleVolumeChange = (e: Event) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    project.setTrackGain(trackId, value);
    pipeline?.setVolume(value);
  };

  const handlePanChange = (e: Event) => {
    const value = parseFloat((e.target as HTMLInputElement).value);
    // Store as 0-1 in lexicon format
    project.setTrackPan(trackId, (value + 1) / 2);
    pipeline?.setPan(value);
  };

  const setupPlayback = (el: HTMLVideoElement) => {
    el.onloadeddata = () => {
      setPlaybackEl(el);
      if (pipeline) {
        pipeline.connect(el);
      }
      props.onVideoChange?.(props.id, el);
    };
  };

  const recordingUrl = createMemo(() => {
    const blob = trackBlob();
    return blob ? URL.createObjectURL(blob) : undefined;
  });

  const getStatus = () => {
    if (props.isLoading) return "Loading...";
    if (props.isRecording) return "Recording";
    if (props.isSelected) return "Preview";
    if (props.isPlaying && hasRecording()) return "Playing";
    if (hasRecording()) return "Ready";
    return "Empty";
  };

  // Convert 0-1 lexicon pan to -1..1 for slider
  const panSliderValue = createMemo(() => (pan() - 0.5) * 2);

  return (
    <div
      class={styles.track}
      classList={{
        [styles.selected]: props.isSelected,
        [styles.recording]: props.isRecording,
        [styles.hasRecording]: hasRecording(),
      }}
      onClick={props.onSelect}
    >
      <div class={styles.trackHeader}>
        <span class={styles.trackLabel}>Track {props.id + 1}</span>
        <span class={styles.status}>{getStatus()}</span>
      </div>

      {/* Hidden video element for playback */}
      <Show when={hasRecording()}>
        <video
          ref={setupPlayback}
          src={recordingUrl()}
          class={styles.hiddenVideo}
          playsinline
        />
      </Show>

      <div class={styles.sliders}>
        <label class={styles.slider}>
          <span>Vol</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={gain()}
            onInput={handleVolumeChange}
            onClick={(e) => e.stopPropagation()}
          />
        </label>
        <label class={styles.slider}>
          <span>Pan</span>
          <input
            type="range"
            min="-1"
            max="1"
            step="0.01"
            value={panSliderValue()}
            onInput={handlePanChange}
            onClick={(e) => e.stopPropagation()}
          />
        </label>
      </div>

      <Show when={hasRecording()}>
        <div class={styles.controls}>
          <button
            class={styles.clearButton}
            onClick={(e) => {
              e.stopPropagation();
              handleClear();
            }}
          >
            <FiTrash2 size={14} />
          </button>
        </div>
      </Show>
    </div>
  );
};
