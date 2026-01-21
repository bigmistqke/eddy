import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'dj.eddy.pipeline',
  defs: {
    output: {
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
