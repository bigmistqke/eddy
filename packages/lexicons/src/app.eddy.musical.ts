/**
 * Musical Time Domain
 *
 * Clips and projects with musical timing (bars/beats).
 * For DAWs, jam, and other music-centric apps.
 */

import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'app.eddy.musical',
  defs: {
    clip: {
      type: 'object',
      description: 'A clip with musical timing (bars)',
      required: ['id', 'bar', 'bars'],
      properties: {
        id: {
          type: 'string',
          maxLength: 64,
        },
        source: {
          type: 'union',
          refs: ['app.eddy.clip#clipSource.stem', 'app.eddy.clip#clipSource.group'],
          description: 'Source media: a stem reference or a nested group',
        },
        bar: {
          type: 'number',
          description: 'Position on timeline in bars (can be fractional)',
          minimum: 0,
        },
        bars: {
          type: 'number',
          description: 'Duration in bars (can be fractional)',
          minimum: 0,
        },
        sourceBar: {
          type: 'number',
          description: 'Start position within source in bars (for trimming)',
          minimum: 0,
          default: 0,
        },
        speed: {
          type: 'union',
          refs: ['app.eddy.value.static#staticValue'],
          description: 'Playback speed multiplier (0.1-10)',
        },
        reverse: {
          type: 'union',
          refs: ['app.eddy.value.static#staticValue'],
          description: 'Play clip in reverse',
        },
        audioPipeline: {
          type: 'ref',
          ref: 'app.eddy.pipeline#audioPipeline',
          description: 'Clip-level audio effect chain',
        },
        videoPipeline: {
          type: 'ref',
          ref: 'app.eddy.pipeline#videoPipeline',
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
        required: ['title', 'canvas', 'tracks', 'clips', 'groups', 'bpm', 'createdAt'],
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
          durationBars: {
            type: 'number',
            description: 'Total project duration in bars',
            minimum: 0,
          },
          canvas: {
            type: 'ref',
            ref: 'app.eddy.project#canvas',
          },
          curves: {
            type: 'array',
            items: {
              type: 'union',
              refs: [
                'app.eddy.value.curve#keyframe',
                'app.eddy.value.curve#envelope',
                'app.eddy.value.curve#lfo',
              ],
            },
            maxLength: 256,
            description: 'Reusable animation curves',
          },
          tracks: {
            type: 'array',
            items: { type: 'ref', ref: 'app.eddy.track#track' },
            maxLength: 32,
            description: 'Tracks (reference clips by ID)',
          },
          clips: {
            type: 'array',
            items: { type: 'ref', ref: '#clip' },
            maxLength: 1024,
            description: 'All clips in musical time',
          },
          groups: {
            type: 'array',
            items: { type: 'ref', ref: 'app.eddy.group#group' },
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
