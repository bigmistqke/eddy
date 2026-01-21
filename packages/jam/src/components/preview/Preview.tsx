/**
 * Preview
 *
 * Renders video tracks using WebGL compositor.
 * Uses makeVideoCompositor and makeVideoPlayback for real video pipeline.
 */

import { createEffect, createMemo, on, onCleanup, onMount } from 'solid-js'
import type { Jam } from '~/primitives/create-jam'
import {
  makeVideoCompositor,
  makeVideoPlayback,
  makeEffectRegistry,
  type VideoCompositor,
  type VideoPlayback,
} from '@eddy/video'
import { UrlSource } from 'mediabunny'
import styles from './Preview.module.css'

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

export interface PreviewProps {
  jam: Jam
}

/**********************************************************************************/
/*                                                                                */
/*                                    Preview                                     */
/*                                                                                */
/**********************************************************************************/

export function Preview(props: PreviewProps) {
  const { jam } = props

  let canvasRef: HTMLCanvasElement | undefined
  let compositor: VideoCompositor | undefined
  let playbacks: Map<string, VideoPlayback> = new Map()
  let animationFrameId: number | null = null

  const canvasWidth = 640
  const canvasHeight = 360

  // Effect registry (empty for now - no effects)
  const effectRegistry = makeEffectRegistry({})

  // Get compiled timeline
  const timeline = createMemo(() => jam.timeline())

  onMount(() => {
    if (!canvasRef) return

    // Create OffscreenCanvas from the visible canvas
    const offscreen = canvasRef.transferControlToOffscreen()

    // Create compositor
    compositor = makeVideoCompositor({
      canvas: offscreen,
      width: canvasWidth,
      height: canvasHeight,
      effectRegistry,
      previewClipId: '__preview__',
    })

    // Load videos for each track
    loadVideos()

    // Start render loop
    startRenderLoop()
  })

  onCleanup(() => {
    // Stop render loop
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId)
      animationFrameId = null
    }

    // Destroy playbacks
    for (const playback of playbacks.values()) {
      playback.pause()
    }
    playbacks.clear()

    // Destroy compositor
    compositor?.destroy()
    compositor = undefined
  })

  async function loadVideos() {
    const tracks = jam.project.tracks

    for (const track of tracks) {
      const videoUrl = jam.trackVideos[track.id]
      if (!videoUrl) continue

      try {
        // Create playback for this track
        const playback = makeVideoPlayback({
          onFrame: frame => {
            if (!compositor || !frame) return
            // Use track.id as clipId for simplicity (1 stem per track model)
            compositor.setFrame(track.id, frame)
          },
        })

        // Load the video using UrlSource
        const source = new UrlSource(videoUrl)
        await playback.load(source)

        // Seek to current time to show initial frame
        await playback.seek(jam.currentTime())

        playbacks.set(track.id, playback)
        console.log(`Loaded video for track ${track.id}: ${videoUrl}`)
      } catch (error) {
        console.error(`Failed to load video for track ${track.id}:`, error)
      }
    }
  }

  function startRenderLoop() {
    function renderFrame() {
      if (!compositor) {
        animationFrameId = requestAnimationFrame(renderFrame)
        return
      }

      // Update timeline
      compositor.setTimeline(timeline())

      // Render at current time
      const time = jam.currentTime()
      compositor.render(time)

      animationFrameId = requestAnimationFrame(renderFrame)
    }

    animationFrameId = requestAnimationFrame(renderFrame)
  }

  // Sync playback state with jam
  createEffect(
    on(
      () => jam.isPlaying(),
      isPlaying => {
        const time = jam.currentTime()

        for (const [trackId, playback] of playbacks) {
          if (isPlaying) {
            playback.play(time)
          } else {
            playback.pause()
          }
        }
      },
    ),
  )

  // Handle seeking
  createEffect(
    on(
      () => jam.currentTime(),
      time => {
        // Only seek if not playing (playing handles its own time sync)
        if (jam.isPlaying()) return

        for (const playback of playbacks.values()) {
          playback.seek(time)
        }
      },
    ),
  )

  return (
    <div class={styles.preview}>
      <canvas
        ref={canvasRef}
        class={styles.canvas}
        width={canvasWidth}
        height={canvasHeight}
      />
    </div>
  )
}
