import { type Component, For, createSignal, onMount, onCleanup } from 'solid-js'
import { FiPlay, FiPause, FiSquare } from 'solid-icons/fi'
import { Track } from './Track'
import { createCompositor, type Compositor } from '~/lib/video/compositor'
import { resumeAudioContext } from '~/lib/audio/context'
import styles from './Timeline.module.css'

interface TimelineProps {
  projectId?: string
}

const TRACK_IDS = [0, 1, 2, 3] as const

export const Timeline: Component<TimelineProps> = () => {
  const [isPlaying, setIsPlaying] = createSignal(false)
  const [currentTime, setCurrentTime] = createSignal<number | undefined>(undefined)

  let compositorContainer: HTMLDivElement | undefined
  let compositor: Compositor | null = null
  let animationId: number | null = null

  onMount(() => {
    compositor = createCompositor(640, 360)
    compositor.canvas.className = styles.compositorCanvas
    if (compositorContainer) {
      compositorContainer.appendChild(compositor.canvas)
    }
    startRenderLoop()
  })

  onCleanup(() => {
    stopRenderLoop()
    compositor?.destroy()
  })

  const startRenderLoop = () => {
    const loop = () => {
      compositor?.render()
      animationId = requestAnimationFrame(loop)
    }
    loop()
  }

  const stopRenderLoop = () => {
    if (animationId) {
      cancelAnimationFrame(animationId)
      animationId = null
    }
  }

  const handleVideoChange = (index: number, video: HTMLVideoElement | null) => {
    compositor?.setVideo(index, video)
  }

  const handlePlayPause = async () => {
    await resumeAudioContext()
    setCurrentTime(undefined)
    setIsPlaying(!isPlaying())
  }

  const handleStop = () => {
    setIsPlaying(false)
    setCurrentTime(0)
  }

  return (
    <div class={styles.container}>
      <div class={styles.compositorContainer} ref={compositorContainer} />
      <div class={styles.transport}>
        <button class={styles.playButton} onClick={handlePlayPause}>
          {isPlaying() ? <FiPause size={24} /> : <FiPlay size={24} />}
        </button>
        <button class={styles.stopButton} onClick={handleStop}>
          <FiSquare size={20} />
        </button>
      </div>
      <div class={styles.grid}>
        <For each={TRACK_IDS}>
          {(id) => (
            <Track
              id={id}
              isPlaying={isPlaying()}
              currentTime={currentTime()}
              onVideoChange={handleVideoChange}
            />
          )}
        </For>
      </div>
    </div>
  )
}

