import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'app.eddy.jam',
  defs: {
    metadata: {
      type: 'object',
      description: 'Jam-specific project metadata for grid-based video sequencing',
      required: ['columns', 'bpm'],
      properties: {
        bpm: {
          type: 'integer',
          description: 'Beats per minute for duration calculations',
          minimum: 20,
          maximum: 300,
          default: 120,
        },
        columns: {
          type: 'array',
          items: { type: 'ref', ref: '#column' },
          maxLength: 256,
          description: 'Column definitions (time segments with layouts)',
        },
      },
    },

    column: {
      type: 'object',
      description: 'A time segment with layout configuration',
      required: ['id', 'duration', 'layout'],
      properties: {
        id: {
          type: 'string',
          maxLength: 64,
        },
        duration: {
          type: 'ref',
          ref: '#columnDuration',
          description: 'Duration in bars',
        },
        layout: {
          type: 'ref',
          ref: '#layoutType',
          description: 'Spatial arrangement type',
        },
        slots: {
          type: 'array',
          items: { type: 'string', maxLength: 64 },
          maxLength: 16,
          description: 'Track IDs assigned to each layout slot',
        },
      },
    },

    columnDuration: {
      type: 'string',
      description: 'Duration in bars (musical time)',
      knownValues: ['1', '1/2', '1/4', '1/8', '1/16'],
    },

    layoutType: {
      type: 'string',
      description: 'Spatial arrangement preset',
      knownValues: ['full', 'pip', '2x2', '3-up', 'h-split', 'v-split'],
    },
  },
} as const satisfies LexiconDoc
