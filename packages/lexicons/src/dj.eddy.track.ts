/**
 * Track
 *
 * A track references clips by ID. The clips themselves are stored
 * at the project level (in either absolute or musical time domain).
 */

import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'dj.eddy.track',
  defs: {
    track: {
      type: 'object',
      description: 'A track referencing clips by ID',
      required: ['id', 'clipIds'],
      properties: {
        id: {
          type: 'string',
          maxLength: 64,
        },
        name: {
          type: 'string',
          maxLength: 128,
        },
        clipIds: {
          type: 'array',
          items: { type: 'string', maxLength: 64 },
          maxLength: 256,
          description: 'IDs of clips belonging to this track',
        },
        audioPipeline: {
          type: 'ref',
          ref: 'dj.eddy.pipeline#audioPipeline',
          description: 'Track-level audio effect chain',
        },
        visualPipeline: {
          type: 'ref',
          ref: 'dj.eddy.pipeline#visualPipeline',
          description: 'Track-level video effect chain',
        },
        muted: {
          type: 'union',
          refs: ['dj.eddy.value.static#fixed'],
          description: 'Mute track',
        },
        solo: {
          type: 'union',
          refs: ['dj.eddy.value.static#fixed'],
          description: 'Solo track',
        },
      },
    },
  },
} as const satisfies LexiconDoc
