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
    'media': {
      type: 'object',
      description: 'A media track with clips in absolute time (ms)',
      required: ['id', 'clips'],
      properties: {
        type: { type: 'string', const: 'media' },
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
          items: {
            type: 'union',
            refs: [
              'dj.eddy.clip#clip.stem',
              'dj.eddy.clip#clip.url',
              'dj.eddy.clip#clip.project',
            ],
            description: 'Source: stem, URL, nested project',
          },
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
    'layout': {
      type: 'object',
      description: 'A metadata track with clips in absolute time (ms)',
      required: ['id', 'clips'],
      properties: {
        type: { type: 'string', const: 'layout' },
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
          items: {
            type: 'ref',
            ref: 'dj.eddy.clip#clip.layout',
            description: 'Source: layout instruction',
          },
          maxLength: 256,
          description: 'Clips owned by this track',
        },
      },
    },

  },
} as const satisfies LexiconDoc
