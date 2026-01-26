import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'dj.eddy.value.static',
  defs: {
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

    customParams: {
      type: 'object',
      description: 'Extensible parameters for custom effects.',
      properties: {},
    },
  },
} as const satisfies LexiconDoc
