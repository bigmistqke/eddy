/**
 * Preview
 *
 * Renders video tracks using WebGL compositor.
 * Draggable overlay that can be repositioned.
 */

import {
  makeEffectRegistry,
  makeVideoCompositor,
  makeVideoPlayback,
  type VideoCompositor,
  type VideoPlayback,
} from '@eddy/video'
import { UrlSource } from 'mediabunny'
import { createEffect, createMemo, createSignal, on, onCleanup, onMount } from 'solid-js'
import type { Jam } from '~/primitives/create-jam'
import styles from './Preview.module.css'

/**********************************************************************************/
/*                                                                                */
/*                                     Types                                      */
/*                                                                                */
/**********************************************************************************/

export interface PreviewProps {
  jam: Jam
}

interface Position {
  x: number
  y: number
}

/**********************************************************************************/
/*                                                                                */
/*                                    Preview                                     */
/*                                                                                */
/**********************************************************************************/

export function Preview(props: PreviewProps) {
  let canvasRef: HTMLCanvasElement | undefined
  let compositor: VideoCompositor | undefined
  let playbacks: Map<string, VideoPlayback> = new Map()
  let animationFrameId: number | null = null

  const canvasWidth = 640
  const canvasHeight = 360

  // Overlay position state
  const [position, setPosition] = createSignal<Position>({ x: 16, y: 16 })
  const [isDragging, setIsDragging] = createSignal(false)
  let dragOffset: Position = { x: 0, y: 0 }

  function handleDragStart(event: PointerEvent) {
    event.preventDefault()
    const _position = position()
    dragOffset = {
      x: event.clientX - _position.x,
      y: event.clientY - _position.y,
    }
    setIsDragging(true)
    ;(event.target as HTMLElement).setPointerCapture(event.pointerId)
  }

  function handleDragMove(event: PointerEvent) {
    if (!isDragging()) return
    setPosition({
      x: event.clientX - dragOffset.x,
      y: event.clientY - dragOffset.y,
    })
  }

  function handleDragEnd() {
    setIsDragging(false)
  }

  // Effect registry (empty for now - no effects)
  const effectRegistry = makeEffectRegistry({})

  // Get compiled timeline
  const timeline = createMemo(() => props.jam.timeline())

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
    const tracks = props.jam.contentTracks()

    for (const track of tracks) {
      const videoUrl = props.jam.trackVideos[track.id]
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
        await playback.seek(props.jam.currentTime())

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
      const time = props.jam.currentTime()
      compositor.render(time)

      animationFrameId = requestAnimationFrame(renderFrame)
    }

    animationFrameId = requestAnimationFrame(renderFrame)
  }

  // Sync playback state with jam
  createEffect(
    on(
      () => props.jam.isPlaying(),
      isPlaying => {
        const time = props.jam.currentTime()

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
      () => props.jam.currentTime(),
      time => {
        // Only seek if not playing (playing handles its own time sync)
        if (props.jam.isPlaying()) return

        for (const playback of playbacks.values()) {
          playback.seek(time)
        }
      },
    ),
  )

  return (
    <div
      class={styles.overlay}
      style={{
        left: `${position().x}px`,
        top: `${position().y}px`,
      }}
    >
      <div
        class={styles.dragHandle}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        <span class={styles.dragIcon}>⋮⋮</span>
        <span class={styles.columnInfo}>
          Column {props.jam.currentColumnIndex() + 1} / {props.jam.metadata.columnCount}
        </span>
      </div>
      <div class={styles.preview}>
        <canvas ref={canvasRef} class={styles.canvas} width={canvasWidth} height={canvasHeight} />
      </div>
    </div>
  )
}
