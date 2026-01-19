import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'app.eddy.track',
  defs: {
    track: {
      type: 'object',
      description: 'A track containing media clips and effect pipelines',
      required: ['id', 'clips'],
      properties: {
        id: {
          type: 'string',
          maxLength: 64,
        },
        name: {
          type: 'string',
          maxLength: 128,
        },
        clips: {
          type: 'array',
          items: { type: 'ref', ref: 'app.eddy.clip#clip' },
          maxLength: 256,
        },
        audioPipeline: {
          type: 'ref',
          ref: 'app.eddy.pipeline#audioPipeline',
          description: 'Track-level audio effect chain with weighted outputs',
        },
        videoPipeline: {
          type: 'ref',
          ref: 'app.eddy.pipeline#videoPipeline',
          description: 'Track-level video effect chain with weighted outputs',
        },
        muted: {
          type: 'union',
          refs: ['app.eddy.value.static#staticValue'],
          description: 'Mute track',
        },
        solo: {
          type: 'union',
          refs: ['app.eddy.value.static#staticValue'],
          description: 'Solo track',
        },
      },
    },
  },
} as const satisfies LexiconDoc
