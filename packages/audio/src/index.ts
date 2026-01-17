// Context
export { getAudioContext, resumeAudioContext } from './context'

// Mixer
export { getMasterMixer, type MasterMixer } from './mixer'

// Effect Chain
export { makeEffectChain, type EffectChain } from './make-effect-chain'

export {
  registerAudioElement,
  type AudioElement,
  type AudioElementFactory,
} from './audio-element-registry'

// Audio Bus
export { makeAudioBus, type AudioBus } from './make-audio-bus'

// Audio Decoder
export {
  isAudioCodecSupported,
  isAudioDecoderSupported,
  makeAudioDecoder,
  type AudioDecoderHandle,
  type CreateAudioDecoderOptions,
} from './make-audio-decoder'

// Ring Buffer
export {
  makeAudioRingBuffer,
  makeAudioRingBufferReader,
  makeAudioRingBufferWriter,
  type AudioRingBuffer,
  type RingBufferWriter,
} from './audio-ring-buffer'

// Scheduler
export {
  isWebAudioSupported,
  makeAudioScheduler,
  type AudioScheduler,
  type AudioSchedulerOptions,
  type AudioSchedulerState,
} from './make-audio-scheduler'

// Playback
export {
  makeAudioPlayback,
  type AudioCallback,
  type AudioPlayback,
  type AudioPlaybackConfig,
  type AudioPlaybackState,
  type EndCallback,
} from './make-audio-playback'

// Offline Mixer
export {
  audioDataArrayToBuffer,
  decodeClipAudio,
  extractAudioChunk,
  makeOfflineAudioMixer,
  type OfflineAudioMixer,
  type TrackAudioConfig,
} from './make-offline-audio-mixer'
