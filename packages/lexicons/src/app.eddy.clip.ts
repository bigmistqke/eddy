/**
 * Clip Sources
 *
 * Shared source types for clips. The actual clip definitions
 * (with timing) are in app.eddy.absolute and app.eddy.musical.
 */

import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'app.eddy.clip',
  defs: {
    'clipSource.stem': {
      type: 'object',
      description: 'Reference to an external stem record',
      required: ['type', 'ref'],
      properties: {
        type: { type: 'string', const: 'stem' },
        ref: {
          type: 'ref',
          ref: 'com.atproto.repo.strongRef',
          description: 'Reference to app.eddy.stem record',
        },
      },
    },

    'clipSource.group': {
      type: 'object',
      description: 'Reference to a group within this project (for nested compositions)',
      required: ['type', 'id'],
      properties: {
        type: { type: 'string', const: 'group' },
        id: {
          type: 'string',
          description: 'ID of the group to use as source',
          maxLength: 64,
        },
      },
    },
  },
} as const satisfies LexiconDoc
