import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'app.eddy.group',
  defs: {
    group: {
      type: 'object',
      description:
        'A group containing tracks or nested groups. Without layout, members stack. With grid layout, members fill cells in order.',
      required: ['id', 'members'],
      properties: {
        id: {
          type: 'string',
          maxLength: 64,
        },
        name: {
          type: 'string',
          maxLength: 128,
        },
        members: {
          type: 'array',
          items: { type: 'union', refs: ['#member', '#member.void'] },
          maxLength: 64,
          description:
            'Track/group IDs or voids. Fill grid cells left-to-right, top-to-bottom. Without layout, all stack.',
        },
        layout: {
          type: 'ref',
          ref: '#layout.grid',
          description: 'Optional grid layout. If omitted, members stack on top of each other.',
        },
        audioPipeline: {
          type: 'array',
          items: {
            type: 'union',
            refs: [
              'app.eddy.audioEffect#pan',
              'app.eddy.audioEffect#gain',
              'app.eddy.audioEffect#reverb',
              'app.eddy.audioEffect#custom',
            ],
          },
          maxLength: 16,
          description: 'Group-level audio effect chain',
        },
        videoPipeline: {
          type: 'array',
          items: {
            type: 'union',
            refs: [
              'app.eddy.visualEffect#transform',
              'app.eddy.visualEffect#opacity',
              'app.eddy.visualEffect#brightness',
              'app.eddy.visualEffect#contrast',
              'app.eddy.visualEffect#saturation',
              'app.eddy.visualEffect#colorize',
              'app.eddy.visualEffect#custom',
            ],
          },
          maxLength: 16,
          description: 'Visual effects applied to the composited group',
        },
      },
    },

    member: {
      type: 'object',
      description: 'Reference to a track or group',
      required: ['id'],
      properties: {
        id: {
          type: 'string',
          description: 'Track ID or group ID',
          maxLength: 64,
        },
      },
    },

    'member.void': {
      type: 'object',
      description: 'Empty cell placeholder (skips a grid cell)',
      required: ['type'],
      properties: {
        type: { type: 'string', const: 'void' },
      },
    },

    'layout.grid': {
      type: 'object',
      description: 'Grid layout configuration',
      required: ['type', 'columns', 'rows'],
      properties: {
        type: { type: 'string', const: 'grid' },
        columns: {
          type: 'integer',
          minimum: 1,
          maximum: 16,
        },
        rows: {
          type: 'integer',
          minimum: 1,
          maximum: 16,
        },
        gap: {
          type: 'union',
          refs: ['app.eddy.value.static#staticValue'],
          description: 'Gap between cells (0-1 relative to group size)',
        },
        padding: {
          type: 'union',
          refs: ['app.eddy.value.static#staticValue'],
          description: 'Padding around grid (0-1 relative to group size)',
        },
      },
    },
  },
} as const satisfies LexiconDoc
