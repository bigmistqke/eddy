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
      description: 'A clip with musical timing (bars)',
      required: ['id', 'tick', 'ticks'],
      properties: {
        id: {
          type: 'string',
          maxLength: 64,
        },
        source: {
          type: 'union',
          refs: ['dj.eddy.clip#source.stem', 'dj.eddy.clip#source.group', 'dj.eddy.clip#source.url'],
          description: 'Source media: a stem reference, nested group, or URL',
        },
        tick: {
          type: 'integer',
          description: 'Position on timeline in ticks',
          minimum: 0,
        },
        ticks: {
          type: 'integer',
          description: 'Duration in ticks',
          minimum: 0,
        },
        sourceTick: {
          type: 'integer',
          description: 'Start position within source in ticks (for trimming)',
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
            description: 'All clips in musical time',
          },
          groups: {
            type: 'array',
            items: { type: 'ref', ref: 'dj.eddy.group#group' },
            maxLength: 64,
            description: 'Groups for spatial composition',
          },
          root: {
            type: 'string',
            description: 'ID of the root entry point (can be a track or group)',
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
