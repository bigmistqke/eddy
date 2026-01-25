/**
 * Absolute Time Domain
 *
 * Clips and projects with absolute timing (milliseconds).
 * For video editors and other apps that don't need musical time.
 */

import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'dj.eddy.absolute',
  defs: {
    clip: {
      type: 'object',
      description: 'A clip with absolute timing (milliseconds)',
      required: ['id', 'offset', 'duration'],
      properties: {
        id: {
          type: 'string',
          maxLength: 64,
        },
        source: {
          type: 'union',
          refs: ['dj.eddy.clip#source.stem', 'dj.eddy.clip#source.group'],
          description: 'Source media: a stem reference or a nested group',
        },
        offset: {
          type: 'integer',
          description: 'Position on timeline in milliseconds',
          minimum: 0,
        },
        duration: {
          type: 'integer',
          description: 'Duration in milliseconds',
          minimum: 0,
        },
        sourceOffset: {
          type: 'integer',
          description: 'Start position within source stem in milliseconds (for trimming)',
          minimum: 0,
          default: 0,
        },
        speed: {
          type: 'union',
          refs: ['dj.eddy.value.static#fixed'],
          description: 'Playback speed multiplier (0.1-10)',
        },
        reverse: {
          type: 'union',
          refs: ['dj.eddy.value.static#fixed'],
          description: 'Play clip in reverse',
        },
        audioPipeline: {
          type: 'ref',
          ref: 'dj.eddy.pipeline#audioPipeline',
          description: 'Clip-level audio effect chain',
        },
        visualPipeline: {
          type: 'ref',
          ref: 'dj.eddy.pipeline#visualPipeline',
          description: 'Clip-level video effect chain',
        },
      },
    },

    project: {
      type: 'record',
      description: 'A project with absolute timing (milliseconds)',
      key: 'tid',
      record: {
        type: 'object',
        required: ['title', 'canvas', 'tracks', 'clips', 'groups', 'createdAt'],
        properties: {
          schemaVersion: {
            type: 'integer',
            description: 'Schema version for migration support',
            default: 1,
          },
          title: {
            type: 'string',
            maxLength: 256,
          },
          description: {
            type: 'string',
            maxLength: 2048,
          },
          duration: {
            type: 'integer',
            description: 'Total project duration in milliseconds',
            minimum: 0,
          },
          canvas: {
            type: 'ref',
            ref: 'dj.eddy.canvas',
          },
          curves: {
            type: 'array',
            items: {
              type: 'union',
              refs: [
                'dj.eddy.value.curve#keyframe',
                'dj.eddy.value.curve#envelope',
                'dj.eddy.value.curve#lfo',
              ],
            },
            maxLength: 256,
            description: 'Reusable animation curves',
          },
          tracks: {
            type: 'array',
            items: { type: 'ref', ref: 'dj.eddy.track#track' },
            maxLength: 32,
            description: 'Tracks (reference clips by ID)',
          },
          clips: {
            type: 'array',
            items: { type: 'ref', ref: '#clip' },
            maxLength: 1024,
            description: 'All clips in absolute time',
          },
          groups: {
            type: 'array',
            items: { type: 'ref', ref: 'dj.eddy.group#group' },
            maxLength: 64,
            description: 'Groups for spatial composition',
          },
          rootGroup: {
            type: 'string',
            description: 'ID of the root group for timeline',
            maxLength: 64,
          },
          parent: {
            type: 'ref',
            ref: 'com.atproto.repo.strongRef',
            description: 'Source project if this is a remix',
          },
          createdAt: {
            type: 'string',
            format: 'datetime',
          },
          updatedAt: {
            type: 'string',
            format: 'datetime',
          },
        },
      },
    },
  },
} as const satisfies LexiconDoc
