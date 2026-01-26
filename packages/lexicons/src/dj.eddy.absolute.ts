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
      required: ['id', 'start'],
      properties: {
        id: {
          type: 'string',
          maxLength: 64,
        },
        source: {
          type: 'union',
          refs: [
            'dj.eddy.clip#source.stem',
            'dj.eddy.clip#source.url',
            'dj.eddy.clip#source.project',
            'dj.eddy.clip#source.layout',
          ],
          description: 'Source: stem, URL, nested project, or layout instruction',
        },
        start: {
          type: 'integer',
          description: 'Position on timeline in milliseconds',
          minimum: 0,
        },
        duration: {
          type: 'integer',
          description: 'Duration in milliseconds. If omitted, extends to next clip on track.',
          minimum: 0,
        },
        offset: {
          type: 'integer',
          description: 'Time shift into content in milliseconds (source in-point)',
        },
        speed: {
          type: 'ref',
          ref: 'dj.eddy.value.static#fixed',
          description: 'Playback speed multiplier (0.1-10)',
        },
        reverse: {
          type: 'boolean',
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
        required: ['title', 'canvas', 'mediaTracks', 'createdAt'],
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
            ref: 'dj.eddy.canvas#canvas',
          },
          mediaTracks: {
            type: 'array',
            items: { type: 'ref', ref: 'dj.eddy.track#media.absolute' },
            maxLength: 32,
            description: 'Media tracks containing stem/url/project clips',
          },
          metadataTracks: {
            type: 'array',
            items: { type: 'ref', ref: 'dj.eddy.track#metadata.absolute' },
            maxLength: 16,
            description: 'Metadata tracks containing layout/curve clips',
          },
          parent: {
            type: 'ref',
            ref: 'com.atproto.repo.strongRef',
            description: 'Source project if this is a remix (pinned to specific version)',
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
