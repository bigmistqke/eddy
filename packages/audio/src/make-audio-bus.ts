import type { AudioEffect } from '@eddy/lexicons'
import { getAudioContext } from './audio-context'
import { type EffectChain, makeEffectChain } from './make-effect-chain'

export interface AudioBus {
  /** The effect chain with all elements */
  effectChain: EffectChain
  /** Set volume (0-1) - updates audio.gain element if present */
  setVolume: (value: number) => void
  /** Get current volume (0-1) */
  getVolume: () => number
  /** Set pan (-1 to 1) - updates audio.pan element if present */
  setPan: (value: number) => void
  /** Connect an HTML media element as source */
  connect: (element: HTMLMediaElement) => void
  /** Disconnect current source */
  disconnect: () => void
  /** Connect an AudioNode as source (for bus chaining) */
  connectNode: (node: AudioNode) => void
  /** Disconnect an AudioNode source */
  disconnectNode: (node: AudioNode) => void
  /**
   * Route output through MediaStream -> HTMLAudioElement instead of direct destination.
   * Use during recording to avoid Chrome bug where destination interferes with getUserMedia.
   */
  useMediaStreamOutput: () => void
  /** Switch back to direct destination output */
  useDirectOutput: () => void
}

export interface AudioBusConfig {
  /** Audio effects to apply */
  effects: AudioEffect[]
  /** Optional destination node (defaults to master mixer) */
  destination?: AudioNode
}

// Track elements that have been connected (can only create one source per element ever)
const connectedElements = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()

/**
 * Create an audio bus for live playback.
 * Uses the element system to build effect nodes from effects.
 * Connects to destination (master mixer by default).
 *
 * @param configOrEffects - Either an AudioBusConfig object or an AudioEffect[] array (for backwards compatibility)
 */
export function makeAudioBus(configOrEffects: AudioBusConfig | AudioEffect[]): AudioBus {
  const ctx = getAudioContext()

  // Handle both config object and legacy array signature
  const config: AudioBusConfig = Array.isArray(configOrEffects)
    ? { effects: configOrEffects }
    : configOrEffects

  // Build effect nodes using the element system
  const pipeline = makeEffectChain(ctx, config.effects)

  // Connect pipeline output to destination (AudioContext.destination by default for root)
  const originalDestination = config.destination ?? ctx.destination
  pipeline.output.connect(originalDestination)

  let currentSource: MediaElementAudioSourceNode | null = null
  const connectedNodes = new Set<AudioNode>()

  // MediaStream output mode state (for root group during recording)
  let mediaStreamDest: MediaStreamAudioDestinationNode | null = null
  let audioElement: HTMLAudioElement | null = null
  let usingMediaStreamOutput = false

  return {
    effectChain: pipeline,

    setVolume(value: number) {
      // value: 0-1
      const gainElement = pipeline.elements.get('audio.gain')
      if (gainElement) {
        gainElement.setParam('value', value)
      }
    },

    getVolume() {
      const gainElement = pipeline.elements.get('audio.gain')
      // Return 1 if no gain element (passthrough)
      return gainElement ? (gainElement as any).node?.gain?.value ?? 1 : 1
    },

    setPan(value: number) {
      // value: -1 (left) to 1 (right)
      const panElement = pipeline.elements.get('audio.pan')
      if (panElement) {
        panElement.setParam('value', value)
      }
    },

    connect(element: HTMLMediaElement) {
      // Disconnect current source from our pipeline
      if (currentSource) {
        currentSource.disconnect()
      }

      // Check if element already has a source node (can only create once per element)
      let source = connectedElements.get(element)
      if (!source) {
        source = ctx.createMediaElementSource(element)
        connectedElements.set(element, source)
      }

      source.connect(pipeline.input)
      currentSource = source
    },

    disconnect() {
      if (currentSource) {
        currentSource.disconnect()
        currentSource = null
      }
    },

    connectNode(node: AudioNode) {
      node.connect(pipeline.input)
      connectedNodes.add(node)
    },

    disconnectNode(node: AudioNode) {
      if (connectedNodes.has(node)) {
        node.disconnect(pipeline.input)
        connectedNodes.delete(node)
      }
    },

    useMediaStreamOutput() {
      if (usingMediaStreamOutput) return

      // Disconnect from original destination
      pipeline.output.disconnect()

      // Create MediaStream destination if needed
      if (!mediaStreamDest) {
        mediaStreamDest = ctx.createMediaStreamDestination()
      }

      // Connect to MediaStream destination
      pipeline.output.connect(mediaStreamDest)

      // Create audio element if needed
      if (!audioElement) {
        audioElement = document.createElement('audio')
        audioElement.autoplay = true
      }

      // Route MediaStream to audio element for playback
      audioElement.srcObject = mediaStreamDest.stream
      audioElement.play().catch(() => {})

      usingMediaStreamOutput = true
    },

    useDirectOutput() {
      if (!usingMediaStreamOutput) return

      // Stop audio element
      if (audioElement) {
        audioElement.pause()
        audioElement.srcObject = null
      }

      // Disconnect from MediaStream destination
      pipeline.output.disconnect()

      // Connect back to original destination
      pipeline.output.connect(originalDestination)

      usingMediaStreamOutput = false
    },
  }
}
