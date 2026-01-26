import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'dj.eddy.pipeline',
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
          type: 'integer',
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
              'dj.eddy.audio.effect#pan',
              'dj.eddy.audio.effect#gain',
              'dj.eddy.audio.effect#reverb',
              'dj.eddy.audio.effect#custom',
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

    visualPipeline: {
      type: 'object',
      description: 'Video effect chain with weighted outputs for parallel routing',
      properties: {
        effects: {
          type: 'array',
          items: {
            type: 'union',
            refs: [
              'dj.eddy.visual.effect#transform',
              'dj.eddy.visual.effect#opacity',
              'dj.eddy.visual.effect#brightness',
              'dj.eddy.visual.effect#contrast',
              'dj.eddy.visual.effect#saturation',
              'dj.eddy.visual.effect#colorize',
              'dj.eddy.visual.effect#custom',
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
