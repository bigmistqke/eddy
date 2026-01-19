import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'app.eddy.clip',
  defs: {
    clip: {
      type: 'object',
      description: 'A region on the timeline referencing part of a stem or group',
      required: ['id', 'offset', 'duration'],
      properties: {
        id: {
          type: 'string',
          maxLength: 64,
        },
        source: {
          type: 'union',
          refs: ['#clipSource.stem', '#clipSource.group'],
          description: 'Source media: a stem reference or a nested group',
        },
        offset: {
          type: 'integer',
          description: 'Position on timeline in milliseconds',
          minimum: 0,
        },
        sourceOffset: {
          type: 'integer',
          description: 'Start position within source stem (for trimming)',
          minimum: 0,
          default: 0,
        },
        duration: {
          type: 'integer',
          description: 'Duration in milliseconds',
          minimum: 0,
        },
        speed: {
          type: 'union',
          refs: ['app.eddy.value.static#staticValue'],
          description: 'Playback speed multiplier (0.1-10)',
        },
        reverse: {
          type: 'union',
          refs: ['app.eddy.value.static#staticValue'],
          description: 'Play clip in reverse',
        },
        audioPipeline: {
          type: 'ref',
          ref: 'app.eddy.pipeline#audioPipeline',
          description: 'Clip-level audio effect chain with weighted outputs',
        },
        videoPipeline: {
          type: 'ref',
          ref: 'app.eddy.pipeline#videoPipeline',
          description: 'Clip-level video effect chain with weighted outputs',
        },
      },
    },

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
