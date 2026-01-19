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
  /** Set the amount (gain) for a specific output by index (for weighted routing) */
  setOutputAmount: (index: number, amount: number) => void
  /** Get the number of outputs */
  outputCount: () => number
}

/** Single output destination with weight */
export interface AudioBusOutput {
  /** Target AudioNode to connect to */
  destination: AudioNode
  /** Output amount 0-1 (default 1) */
  amount?: number
}

export interface AudioBusConfig {
  /** Audio effects to apply */
  effects: AudioEffect[]
  /** Optional single destination node (defaults to AudioContext.destination) */
  destination?: AudioNode
  /** Optional weighted outputs for parallel routing (overrides destination if provided) */
  outputs?: AudioBusOutput[]
}

// Track elements that have been connected (can only create one source per element ever)
const connectedElements = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>()

/**
 * Create an audio bus for live playback.
 * Uses the element system to build effect nodes from effects.
 * Supports weighted outputs for parallel signal routing.
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

  // Output gain nodes for weighted routing
  const outputGains: GainNode[] = []

  // Determine output configuration
  if (config.outputs && config.outputs.length > 0) {
    // Weighted outputs mode: create GainNode for each output
    for (const output of config.outputs) {
      const gain = ctx.createGain()
      gain.gain.value = output.amount ?? 1
      pipeline.output.connect(gain)
      gain.connect(output.destination)
      outputGains.push(gain)
    }
  } else {
    // Single destination mode (backwards compatible)
    const originalDestination = config.destination ?? ctx.destination
    // Create a gain node for consistency (allows setOutputAmount to work)
    const gain = ctx.createGain()
    gain.gain.value = 1
    pipeline.output.connect(gain)
    gain.connect(originalDestination)
    outputGains.push(gain)
  }

  // Store original destinations for reconnecting after MediaStream mode
  const originalDestinations = outputGains.map((gain, index) => {
    if (config.outputs && config.outputs[index]) {
      return config.outputs[index].destination
    }
    return config.destination ?? ctx.destination
  })

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

      // Disconnect all output gains from their destinations
      for (const gain of outputGains) {
        gain.disconnect()
      }

      // Create MediaStream destination if needed
      if (!mediaStreamDest) {
        mediaStreamDest = ctx.createMediaStreamDestination()
      }

      // Connect all output gains to MediaStream destination
      // (audio sums at the MediaStream destination)
      for (const gain of outputGains) {
        gain.connect(mediaStreamDest)
      }

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

      // Disconnect all output gains from MediaStream destination
      for (const gain of outputGains) {
        gain.disconnect()
      }

      // Reconnect each output gain to its original destination
      for (let index = 0; index < outputGains.length; index++) {
        outputGains[index].connect(originalDestinations[index])
      }

      usingMediaStreamOutput = false
    },

    setOutputAmount(index: number, amount: number) {
      const gain = outputGains[index]
      if (gain) {
        gain.gain.setValueAtTime(amount, ctx.currentTime)
      }
    },

    outputCount() {
      return outputGains.length
    },
  }
}
