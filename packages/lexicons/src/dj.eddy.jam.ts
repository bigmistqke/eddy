import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'dj.eddy.jam',
  defs: {
    metadata: {
      type: 'object',
      description: 'Jam-specific project metadata for grid-based video sequencing',
      required: ['bpm', 'columnCount', 'columnDuration', 'layoutRegions'],
      properties: {
        bpm: {
          type: 'integer',
          description: 'Beats per minute for duration calculations',
          minimum: 20,
          maximum: 300,
          default: 120,
        },
        columnCount: {
          type: 'integer',
          description: 'Number of columns in the grid',
          minimum: 1,
          maximum: 256,
          default: 8,
        },
        columnDuration: {
          type: 'ref',
          ref: '#columnDuration',
          description: 'Duration per column in bars (same for all columns)',
        },
        layoutRegions: {
          type: 'array',
          items: { type: 'ref', ref: '#layoutRegion' },
          maxLength: 256,
          description: 'Layout regions spanning multiple columns',
        },
      },
    },

    layoutRegion: {
      type: 'object',
      description: 'A layout region spanning one or more columns',
      required: ['id', 'startColumn', 'endColumn', 'layout'],
      properties: {
        id: {
          type: 'string',
          maxLength: 64,
        },
        startColumn: {
          type: 'integer',
          description: 'Start column index (inclusive)',
          minimum: 0,
        },
        endColumn: {
          type: 'integer',
          description: 'End column index (exclusive)',
          minimum: 1,
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
