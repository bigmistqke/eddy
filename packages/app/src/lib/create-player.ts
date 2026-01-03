import { createCompositor, type VideoSource } from "@klip/compositor";
import type { Playback } from "@klip/playback";
import { createComputed } from "solid-js";

export interface PlayerSlot {
  playback: Playback;
  trackIndex: number;
  unsubscribe: () => void;
}

export interface Player {
  /** The canvas element for rendering */
  readonly canvas: HTMLCanvasElement;

  /** Currently attached players */
  readonly slots: ReadonlyArray<PlayerSlot | null>;

  /** Set a video source for a track (for preview) */
  setSource(trackIndex: number, source: VideoSource | null): void;

  /** Set a video frame for a track */
  setFrame(trackIndex: number, frame: VideoFrame | null): void;

  /** Attach a playback instance to a track */
  attach(trackIndex: number, playback: Playback): void;

  /** Detach a playback instance from a track */
  detach(trackIndex: number): void;

  /** Start the render loop */
  start(): void;

  /** Stop the render loop */
  stop(): void;

  /** Render a single frame */
  renderFrame(): void;

  /** Clean up all resources */
  destroy(): void;
}

export interface PlayerOptions {
  /** Whether to start rendering immediately (default: true) */
  autoStart?: boolean;
}

/**
 * Create a playback compositor
 */
export function createPlayer(
  width: number,
  height: number,
  options: PlayerOptions = {}
): Player {
  const compositor = createCompositor(width, height);
  const slots: (PlayerSlot | null)[] = [null, null, null, null];
  let animationFrameId: number | null = null;
  let isRunning = false;

  function renderLoop() {
    if (!isRunning) return;

    // Update compositor with current frames from all players
    for (const slot of slots) {
      if (slot) {
        const frame = slot.playback.getCurrentFrame();
        compositor.setFrame(slot.trackIndex, frame);
      }
    }

    compositor.render();
    animationFrameId = requestAnimationFrame(renderLoop);
  };


  function start(): void {
    if (isRunning) return;
    isRunning = true;
    animationFrameId = requestAnimationFrame(renderLoop);
  }

  function stop(): void {
    isRunning = false;
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  }

  function detach(trackIndex: number): void {
    const slot = slots[trackIndex];
    if (slot) {
      slot.unsubscribe();
      compositor.setFrame(trackIndex, null);
      slots[trackIndex] = null;
    }
  }

  createComputed(() => {
    if (options.autoStart ?? true) {
      start();
    }
  })

  return {
    get canvas() {
      return compositor.canvas;
    },

    get slots() {
      return slots;
    },

    detach,
    start,
    stop,
    setSource: compositor.setSource.bind(compositor),
    setFrame: compositor.setFrame.bind(compositor),

    attach(trackIndex: number, playback: Playback): void {
      if (trackIndex < 0 || trackIndex > 3) {
        throw new Error(`Track index must be 0-3, got ${trackIndex}`);
      }

      // Detach existing if any
      if (slots[trackIndex]) {
        detach(trackIndex);
      }

      const unsubscribe = playback.onFrame(() => {
        // Frame updates handled in render loop
      });

      slots[trackIndex] = {
        playback,
        trackIndex,
        unsubscribe,
      };
    },

    renderFrame(): void {
      for (const slot of slots) {
        if (slot) {
          const frame = slot.playback.getCurrentFrame();
          compositor.setFrame(slot.trackIndex, frame);
        }
      }
      compositor.render();
    },

    destroy(): void {
      stop();
      for (let i = 0; i < 4; i++) {
        if (slots[i]) {
          detach(i);
        }
      }
      compositor.destroy();
    },
  };
}
