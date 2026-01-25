import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'dj.eddy.value.static',
  defs: {
    fixed: {
      type: 'object',
      description:
        "A static numeric value. Values are integers scaled by 100 (e.g., 50 = 0.5, 100 = 1.0). This avoids floats which AT Protocol doesn't support.",
      required: ['value'],
      properties: {
        value: {
          type: 'integer',
          description: 'Value scaled by 100 (50 = 0.5)',
        },
        min: {
          type: 'integer',
          description: 'Minimum allowed value (scaled by 100)',
          default: 0,
        },
        max: {
          type: 'integer',
          description: 'Maximum allowed value (scaled by 100)',
          default: 100,
        },
        default: {
          type: 'integer',
          description: 'Default value if not specified (scaled by 100)',
        },
      },
    },

    vec2: {
      type: 'object',
      description:
        'A static 2D vector. Each component is an integer scaled by 100 (e.g., [50, 100] = [0.5, 1.0]).',
      required: ['value'],
      properties: {
        value: {
          type: 'array',
          items: { type: 'integer' },
          minLength: 2,
          maxLength: 2,
          description: '[x, y] each scaled by 100',
        },
      },
    },

    vec3: {
      type: 'object',
      description:
        'A static 3D vector. Each component is an integer scaled by 100 (e.g., [100, 50, 0] = [1.0, 0.5, 0.0]).',
      required: ['value'],
      properties: {
        value: {
          type: 'array',
          items: { type: 'integer' },
          minLength: 3,
          maxLength: 3,
          description: '[x, y, z] each scaled by 100',
        },
      },
    },

    vec4: {
      type: 'object',
      description:
        'A static 4D vector. Each component is an integer scaled by 100 (e.g., [100, 50, 0, 100] = [1.0, 0.5, 0.0, 1.0]).',
      required: ['value'],
      properties: {
        value: {
          type: 'array',
          items: { type: 'integer' },
          minLength: 4,
          maxLength: 4,
          description: '[x, y, z, w] each scaled by 100',
        },
      },
    },

    blendMode: {
      type: 'object',
      description: 'A static blend mode value.',
      required: ['value'],
      properties: {
        value: {
          type: 'string',
          enum: ['normal', 'multiply', 'screen', 'overlay', 'add'],
          default: 'normal',
          description: 'Blend mode for compositing',
        },
      },
    },

    customParams: {
      type: 'object',
      description: 'Extensible parameters for custom effects.',
      properties: {},
    },
  },
} as const satisfies LexiconDoc
