/**
 * Reverb Audio Effect
 *
 * A convolution-based reverb using a synthetic impulse response.
 * Supports wet/dry mix, decay time, and pre-delay.
 */

import type { AudioElement, AudioElementParams } from '../audio-element-registry'
import { makeAudioElementRegistration } from '../utils'

/**********************************************************************************/
/*                                                                                */
/*                              Impulse Response Gen                              */
/*                                                                                */
/**********************************************************************************/

/**
 * Generate a synthetic impulse response for reverb.
 * Uses exponential decay with noise.
 */
function generateImpulseResponse(
  ctx: BaseAudioContext,
  duration: number,
  decay: number,
): AudioBuffer {
  const sampleRate = ctx.sampleRate
  const length = sampleRate * duration
  const buffer = ctx.createBuffer(2, length, sampleRate)

  for (let channel = 0; channel < 2; channel++) {
    const channelData = buffer.getChannelData(channel)
    for (let i = 0; i < length; i++) {
      // Exponential decay with random noise
      const t = i / sampleRate
      channelData[i] = (Math.random() * 2 - 1) * Math.exp(-t / decay)
    }
  }

  return buffer
}

/**********************************************************************************/
/*                                                                                */
/*                                 Reverb Factory                                 */
/*                                                                                */
/**********************************************************************************/

/**
 * Create a reverb audio element.
 *
 * Params (all 0-100 scaled):
 * - mix: wet/dry mix (0 = dry, 100 = wet) - default 30
 * - decay: decay time in seconds * 100 (e.g., 200 = 2s) - default 150
 * - preDelay: pre-delay in ms (0-100ms) - default 10
 */
function makeReverbElement(ctx: BaseAudioContext, params: AudioElementParams): AudioElement {
  // Extract params with defaults
  const mix = (params.mix ?? 30) / 100 // 0-1
  const decayTime = (params.decay ?? 150) / 100 // seconds
  const preDelayMs = params.preDelay ?? 10 // ms

  // Create nodes
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const convolver = ctx.createConvolver()
  const preDelay = ctx.createDelay(0.1) // max 100ms

  // Generate impulse response
  const impulseResponse = generateImpulseResponse(ctx, Math.max(decayTime * 2, 1), decayTime)
  convolver.buffer = impulseResponse

  // Set initial values
  dry.gain.value = 1 - mix
  wet.gain.value = mix
  preDelay.delayTime.value = preDelayMs / 1000

  // Wire up the graph:
  // input -> dry -> output
  // input -> preDelay -> convolver -> wet -> output
  input.connect(dry)
  dry.connect(output)

  input.connect(preDelay)
  preDelay.connect(convolver)
  convolver.connect(wet)
  wet.connect(output)

  // Track current params for regeneration
  let currentDecay = decayTime

  return {
    node: input,
    output,

    setParam(name, value) {
      switch (name) {
        case 'mix': {
          // value is 0-100
          const normalizedMix = value / 100
          dry.gain.value = 1 - normalizedMix
          wet.gain.value = normalizedMix
          break
        }
        case 'decay': {
          // value is seconds * 100
          const newDecay = value / 100
          if (Math.abs(newDecay - currentDecay) > 0.1) {
            // Regenerate impulse response if decay changed significantly
            currentDecay = newDecay
            const newImpulse = generateImpulseResponse(ctx, Math.max(newDecay * 2, 1), newDecay)
            convolver.buffer = newImpulse
          }
          break
        }
        case 'preDelay': {
          // value is ms (0-100)
          preDelay.delayTime.value = value / 1000
          break
        }
      }
    },

    dispose() {
      // Disconnect all nodes
      input.disconnect()
      dry.disconnect()
      wet.disconnect()
      convolver.disconnect()
      preDelay.disconnect()
      output.disconnect()
    },
  }
}

/**********************************************************************************/
/*                                                                                */
/*                                  Registration                                  */
/*                                                                                */
/**********************************************************************************/

/** Register the reverb effect (idempotent) */
export const registerReverbElement = makeAudioElementRegistration('audio.reverb', makeReverbElement)
