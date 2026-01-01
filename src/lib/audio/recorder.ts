export interface RecordingResult {
  blob: Blob
  duration: number
  type: 'audio' | 'video'
}

export async function requestMediaAccess(video: boolean = false): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: true,
    video: video ? { facingMode: 'user' } : false,
  })
}

export function createRecorder(stream: MediaStream): {
  start: () => void
  stop: () => Promise<RecordingResult>
} {
  const hasVideo = stream.getVideoTracks().length > 0
  const mimeType = hasVideo ? 'video/webm;codecs=vp9,opus' : 'audio/webm;codecs=opus'

  const mediaRecorder = new MediaRecorder(stream, { mimeType })
  const chunks: Blob[] = []
  let startTime = 0

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) {
      chunks.push(e.data)
    }
  }

  return {
    start() {
      chunks.length = 0
      startTime = performance.now()
      mediaRecorder.start()
    },
    stop() {
      return new Promise<RecordingResult>((resolve) => {
        mediaRecorder.onstop = () => {
          const duration = performance.now() - startTime // milliseconds
          const blob = new Blob(chunks, { type: mimeType })
          resolve({ blob, duration, type: hasVideo ? 'video' : 'audio' })
        }
        mediaRecorder.stop()
      })
    },
  }
}
