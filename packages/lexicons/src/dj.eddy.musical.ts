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
    project: {
      type: 'record',
      description: 'A project with musical timing (bars/beats)',
      key: 'tid',
      record: {
        type: 'object',
        required: ['type', 'title', 'canvas', 'mediaTracks', 'bpm', 'createdAt'],
        properties: {
          type: {
            type: 'string', const: 'musical'
          },
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
            items: { type: 'ref', ref: 'dj.eddy.track#media' },
            maxLength: 32,
            description: 'Media tracks containing stem/url/project clips',
          },
          metadataTracks: {
            type: 'array',
            items: { type: 'union', refs: ['dj.eddy.track#layout'] },
            maxLength: 16,
            description: 'Metadata tracks containing layout clips',
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
