/**
 * Musical Time Domain
 *
 * Clips and projects with musical timing (bars/beats).
 * For DAWs, jam, and other music-centric apps.
 */

import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'dj.eddy.musical',
  defs: {
    clip: {
      type: 'object',
      description: 'A clip with musical timing (ticks)',
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
          description: 'Position on timeline in ticks',
          minimum: 0,
        },
        duration: {
          type: 'integer',
          description: 'Duration in ticks. If omitted, extends to next clip on track.',
          minimum: 0,
        },
        offset: {
          type: 'integer',
          description: 'Time shift into content in ticks (source in-point)',
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
      description: 'A project with musical timing (bars/beats)',
      key: 'tid',
      record: {
        type: 'object',
        required: ['title', 'canvas', 'mediaTracks', 'bpm', 'createdAt'],
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
          bpm: {
            type: 'integer',
            description: 'Beats per minute (scaled by 100, e.g., 12000 = 120 BPM)',
            minimum: 2000,
            maximum: 40000,
          },
          timeSignature: {
            type: 'ref',
            ref: '#timeSignature',
            description: 'Time signature (defaults to 4/4)',
          },
          ppq: {
            type: 'integer',
            description: 'Pulses (ticks) per quarter note - defines resolution (default 960)',
            minimum: 24,
            maximum: 9600,
            default: 960,
          },
          durationTicks: {
            type: 'integer',
            description: 'Total project duration in ticks',
            minimum: 0,
          },
          canvas: {
            type: 'ref',
            ref: 'dj.eddy.canvas#canvas',
          },
          mediaTracks: {
            type: 'array',
            items: { type: 'ref', ref: 'dj.eddy.track#media.musical' },
            maxLength: 32,
            description: 'Media tracks containing stem/url/project clips',
          },
          metadataTracks: {
            type: 'array',
            items: { type: 'ref', ref: 'dj.eddy.track#metadata.musical' },
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

    timeSignature: {
      type: 'object',
      description: 'Musical time signature',
      required: ['numerator', 'denominator'],
      properties: {
        numerator: {
          type: 'integer',
          description: 'Beats per bar (e.g., 4 in 4/4)',
          minimum: 1,
          maximum: 32,
        },
        denominator: {
          type: 'integer',
          description: 'Beat unit (e.g., 4 in 4/4 means quarter note)',
          enum: [1, 2, 4, 8, 16, 32],
        },
      },
    },
  },
} as const satisfies LexiconDoc
