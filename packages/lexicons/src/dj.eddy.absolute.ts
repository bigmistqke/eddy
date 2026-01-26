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
    project: {
      type: 'record',
      description: 'A project with absolute timing (milliseconds)',
      key: 'tid',
      record: {
        type: 'object',
        required: ['type', 'title', 'canvas', 'mediaTracks', 'createdAt'],
        properties: {
          type: {
            type: 'string', const: 'absolute'
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
  },
} as const satisfies LexiconDoc
