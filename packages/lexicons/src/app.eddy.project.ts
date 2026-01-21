/**
 * Project Shared Types
 *
 * Shared definitions used by both absolute and musical projects.
 * The project records themselves are in app.eddy.absolute and app.eddy.musical.
 */

import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'app.eddy.project',
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
