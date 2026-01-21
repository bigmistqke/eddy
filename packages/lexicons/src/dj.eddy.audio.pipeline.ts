import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'dj.eddy.audio.pipeline',
  defs: {
    output: {
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
  },
} as const satisfies LexiconDoc
