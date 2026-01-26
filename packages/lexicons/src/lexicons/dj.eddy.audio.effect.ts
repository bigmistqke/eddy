import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'dj.eddy.audio.effect',
  defs: {
    'gain.params': {
      type: 'object',
      required: ['value'],
      properties: {
        value: {
          type: 'integer',
          description: 'Volume (0-100, where 100 = unity gain)',
        },
      },
    },

    gain: {
      type: 'object',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'audio.gain' },
        enabled: {
          type: 'integer',
        },
        params: { type: 'ref', ref: '#gain.params' },
      },
    },

    'pan.params': {
      type: 'object',
      required: ['value'],
      properties: {
        value: {
          type: 'integer',
          description: 'Stereo position (0 = left, 50 = center, 100 = right)',
        },
      },
    },

    pan: {
      type: 'object',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'audio.pan' },
        enabled: {
          type: 'integer',
        },
        params: { type: 'ref', ref: '#pan.params' },
      },
    },

    'reverb.params': {
      type: 'object',
      properties: {
        mix: {
          type: 'integer',
          description: 'Wet/dry mix (0 = dry, 100 = wet)',
        },
        decay: {
          type: 'integer',
          description: 'Decay time scaled by 100 (e.g., 200 = 2 seconds)',
        },
        preDelay: {
          type: 'integer',
          description: 'Pre-delay in milliseconds (0-100)',
        },
      },
    },

    reverb: {
      type: 'object',
      description: 'Convolution-based reverb effect with wet/dry mix',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'audio.reverb' },
        enabled: {
          type: 'integer',
        },
        params: { type: 'ref', ref: '#reverb.params' },
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
        enabled: {
          type: 'integer',
        },
        params: { type: 'unknown' },
      },
    },
  },
} as const satisfies LexiconDoc
