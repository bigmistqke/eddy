/**
 * Track
 *
 * A track contains clips inline. Clips are owned by the track.
 * Pipelines handle audio/visual effects and routing.
 */

import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'dj.eddy.track',
  defs: {
    // Media track for absolute timing (ms)
    'media.absolute': {
      type: 'object',
      description: 'A media track with clips in absolute time (ms)',
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
          items: { type: 'ref', ref: 'dj.eddy.absolute#clip' },
          maxLength: 256,
          description: 'Clips owned by this track',
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
          type: 'boolean',
          description: 'Mute track',
        },
        solo: {
          type: 'boolean',
          description: 'Solo track',
        },
      },
    },

    // Media track for musical timing (ticks)
    'media.musical': {
      type: 'object',
      description: 'A media track with clips in musical time (ticks)',
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
          items: { type: 'ref', ref: 'dj.eddy.musical#clip' },
          maxLength: 256,
          description: 'Clips owned by this track',
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
          type: 'boolean',
          description: 'Mute track',
        },
        solo: {
          type: 'boolean',
          description: 'Solo track',
        },
      },
    },

    // Metadata track for absolute timing (layout, curves, etc.)
    'metadata.absolute': {
      type: 'object',
      description: 'A metadata track with clips in absolute time (ms)',
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
          items: { type: 'ref', ref: 'dj.eddy.absolute#clip' },
          maxLength: 256,
          description: 'Metadata clips (layout, curves, etc.)',
        },
      },
    },

    // Metadata track for musical timing
    'metadata.musical': {
      type: 'object',
      description: 'A metadata track with clips in musical time (ticks)',
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
          items: { type: 'ref', ref: 'dj.eddy.musical#clip' },
          maxLength: 256,
          description: 'Metadata clips (layout, curves, etc.)',
        },
      },
    },
  },
} as const satisfies LexiconDoc
