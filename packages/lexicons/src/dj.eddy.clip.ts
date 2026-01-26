/**
 * Clip Sources
 *
 * Shared source types for clips. The actual clip definitions
 * (with timing) are in dj.eddy.absolute and dj.eddy.musical.
 */

import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'dj.eddy.clip',
  defs: {
    'source.stem': {
      type: 'object',
      description: 'Reference to an external stem record',
      required: ['type', 'ref'],
      properties: {
        type: { type: 'string', const: 'stem' },
        ref: {
          type: 'ref',
          ref: 'com.atproto.repo.strongRef',
          description: 'Reference to dj.eddy.stem record',
        },
      },
    },

    'source.url': {
      type: 'object',
      description: 'Direct URL reference for local/external media',
      required: ['type', 'url'],
      properties: {
        type: { type: 'string', const: 'url' },
        url: {
          type: 'string',
          format: 'uri',
          description: 'URL of the media file',
        },
      },
    },

    'source.project': {
      type: 'object',
      description: 'Reference to another project for nested composition',
      required: ['type', 'uri'],
      properties: {
        type: { type: 'string', const: 'project' },
        uri: {
          type: 'string',
          format: 'at-uri',
          description: 'AT URI of the project to embed',
        },
      },
    },

    'source.layout': {
      type: 'object',
      description: 'Layout instruction for arranging tracks',
      required: ['type', 'mode', 'slots'],
      properties: {
        type: { type: 'string', const: 'layout' },
        mode: {
          type: 'string',
          enum: ['grid', 'focus', 'pip', 'split'],
          description: 'Layout mode',
        },
        slots: {
          type: 'array',
          items: { type: 'string', maxLength: 64 },
          maxLength: 16,
          description: 'Track IDs to include in layout, in order',
        },
        columns: {
          type: 'integer',
          minimum: 1,
          maximum: 8,
          description: 'Number of columns (for grid mode)',
        },
        rows: {
          type: 'integer',
          minimum: 1,
          maximum: 8,
          description: 'Number of rows (for grid mode)',
        },
        gap: {
          type: 'integer',
          minimum: 0,
          maximum: 100,
          description: 'Gap between cells (0-100, percentage of cell size)',
        },
      },
    },
  },
} as const satisfies LexiconDoc
