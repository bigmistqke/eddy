import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'app.eddy.pipeline',
  defs: {
    output: {
      type: 'object',
      description: 'Weighted output routing to a target bus',
      required: ['ref', 'amount'],
      properties: {
        ref: {
          type: 'string',
          maxLength: 64,
          description: 'Target bus ID (track, group, or special bus)',
        },
        amount: {
          type: 'ref',
          ref: 'app.eddy.value.static#staticValue',
          description: 'Output amount (0-100)',
        },
      },
    },

    audioPipeline: {
      type: 'object',
      description: 'Audio effect chain with weighted outputs for parallel routing',
      properties: {
        effects: {
          type: 'array',
          items: {
            type: 'union',
            refs: [
              'app.eddy.audioEffect#pan',
              'app.eddy.audioEffect#gain',
              'app.eddy.audioEffect#reverb',
              'app.eddy.audioEffect#custom',
            ],
          },
          maxLength: 16,
          description: 'Audio effects in processing order',
        },
        outputs: {
          type: 'array',
          items: { type: 'ref', ref: '#output' },
          maxLength: 8,
          description: 'Weighted outputs for parallel signal routing',
        },
      },
    },

    videoPipeline: {
      type: 'object',
      description: 'Video effect chain with weighted outputs for parallel routing',
      properties: {
        effects: {
          type: 'array',
          items: {
            type: 'union',
            refs: [
              'app.eddy.visualEffect#transform',
              'app.eddy.visualEffect#opacity',
              'app.eddy.visualEffect#brightness',
              'app.eddy.visualEffect#contrast',
              'app.eddy.visualEffect#saturation',
              'app.eddy.visualEffect#colorize',
              'app.eddy.visualEffect#custom',
            ],
          },
          maxLength: 16,
          description: 'Video effects in processing order',
        },
        outputs: {
          type: 'array',
          items: { type: 'ref', ref: '#output' },
          maxLength: 8,
          description: 'Weighted outputs for parallel signal routing',
        },
      },
    },
  },
} as const satisfies LexiconDoc
