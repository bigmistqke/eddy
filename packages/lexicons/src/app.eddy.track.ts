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
          description: 'Track-level audio effect chain',
        },
        videoPipeline: {
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
          description: 'Track-level video effect chain',
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
