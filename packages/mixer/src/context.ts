let audioContext: AudioContext | null = null

export function getAudioContext(): AudioContext {
  return audioContext ??= new AudioContext()
}

export function resumeAudioContext(): Promise<void> {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') {
    return ctx.resume()
  }
  return Promise.resolve()
}
