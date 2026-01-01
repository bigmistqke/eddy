export interface RecordingResult {
  blob: Blob
  duration: number
}

export async function requestMicrophoneAccess(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: true })
}

export function createRecorder(stream: MediaStream): {
  start: () => void
  stop: () => Promise<RecordingResult>
} {
  const mediaRecorder = new MediaRecorder(stream, {
    mimeType: 'audio/webm;codecs=opus',
  })
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
          const duration = (performance.now() - startTime) / 1000
          const blob = new Blob(chunks, { type: 'audio/webm;codecs=opus' })
          resolve({ blob, duration })
        }
        mediaRecorder.stop()
      })
    },
  }
}
