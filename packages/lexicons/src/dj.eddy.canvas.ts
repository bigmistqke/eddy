import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'dj.eddy.canvas',
  defs: {
    canvas: {
      type: 'object',
      description: 'Output canvas dimensions',
      required: ['width', 'height'],
      properties: {
        width: {
          type: 'integer',
          minimum: 1,
          maximum: 4096,
        },
        height: {
          type: 'integer',
          minimum: 1,
          maximum: 4096,
        },
        background: {
          type: 'string',
          description: "Background color (hex) or 'transparent'",
          maxLength: 32,
        },
      },
    },
  },
} as const satisfies LexiconDoc
