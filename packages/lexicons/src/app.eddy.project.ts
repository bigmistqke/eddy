import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'app.eddy.project',
  defs: {
    main: {
      type: 'record',
      description: 'A Eddy project containing groups, tracks, curves, and effect pipelines',
      key: 'tid',
      record: {
        type: 'object',
        required: ['title', 'canvas', 'groups', 'tracks', 'createdAt'],
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
            description:
              'Beats per minute for grid/sync features (scaled by 100, e.g., 12000 = 120 BPM)',
            minimum: 2000,
            maximum: 40000,
          },
          duration: {
            type: 'integer',
            description: 'Total project duration in milliseconds',
            minimum: 0,
          },
          canvas: {
            type: 'ref',
            ref: '#canvas',
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
            description:
              'Reusable animation curves. Each curve has a unique id field; validators must reject duplicates. Runtime may convert to map for O(1) lookup.',
          },
          groups: {
            type: 'array',
            items: { type: 'ref', ref: 'app.eddy.group#group' },
            maxLength: 64,
            description:
              'Groups containing tracks. Without layout, members stack. With grid layout, members fill cells.',
          },
          rootGroup: {
            type: 'string',
            description:
              'ID of the group that serves as the timeline root. If not set, defaults to first group.',
            maxLength: 64,
          },
          tracks: {
            type: 'array',
            items: { type: 'ref', ref: 'app.eddy.track#track' },
            maxLength: 32,
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

    canvas: {
      type: 'object',
      description: 'Output canvas dimensions',
      required: ['width', 'height'],
      properties: {
        width: {
          type: 'integer',
          minimum: 1,
          maximum: 4096,
        },
        height: {
          type: 'integer',
          minimum: 1,
          maximum: 4096,
        },
        background: {
          type: 'string',
          description: "Background color (hex) or 'transparent'",
          maxLength: 32,
        },
      },
    },
  },
} as const satisfies LexiconDoc
