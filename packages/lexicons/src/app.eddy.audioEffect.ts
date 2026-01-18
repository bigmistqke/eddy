import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'app.eddy.audioEffect',
  defs: {
    'gain.params': {
      type: 'object',
      required: ['value'],
      properties: {
        value: {
          type: 'union',
          refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */,
          description: 'Volume (0-100, where 100 = unity gain)',
        },
      },
    },

    'pan.params': {
      type: 'object',
      required: ['value'],
      properties: {
        value: {
          type: 'union',
          refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */,
          description: 'Stereo position (0 = left, 50 = center, 100 = right)',
        },
      },
    },

    'reverb.params': {
      type: 'object',
      properties: {
        mix: {
          type: 'union',
          refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */,
          description: 'Wet/dry mix (0 = dry, 100 = wet)',
        },
        decay: {
          type: 'union',
          refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */,
          description: 'Decay time scaled by 100 (e.g., 200 = 2 seconds)',
        },
        preDelay: {
          type: 'union',
          refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */,
          description: 'Pre-delay in milliseconds (0-100)',
        },
      },
    },

    gain: {
      type: 'object',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'audio.gain' },
        enabled: { type: 'union', refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */ },
        params: { type: 'ref', ref: '#gain.params' },
      },
    },

    pan: {
      type: 'object',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'audio.pan' },
        enabled: { type: 'union', refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */ },
        params: { type: 'ref', ref: '#pan.params' },
      },
    },

    custom: {
      type: 'object',
      description: 'Custom or third-party audio effect',
      required: ['type'],
      properties: {
        type: {
          type: 'string',
          description: "Custom effect identifier (e.g., 'audio.vendor.effectName')",
        },
        enabled: { type: 'union', refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */ },
      },
    },

    reverb: {
      type: 'object',
      description: 'Convolution-based reverb effect with wet/dry mix',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'audio.reverb' },
        enabled: { type: 'union', refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */ },
        params: { type: 'ref', ref: '#reverb.params' },
      },
    },
  },
} as const satisfies LexiconDoc
