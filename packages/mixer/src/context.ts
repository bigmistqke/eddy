let audioContext: AudioContext | null = null

export function getAudioContext(): AudioContext {
  // Use 48000Hz - standard sample rate for video recording
  return (audioContext ??= new AudioContext({ sampleRate: 48000 }))
}

export function resumeAudioContext(): Promise<void> {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') {
    return ctx.resume()
  }
  return Promise.resolve()
}
