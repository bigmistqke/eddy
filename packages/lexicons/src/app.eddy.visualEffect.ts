import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'app.eddy.visualEffect',
  defs: {
    'transform.params': {
      type: 'object',
      properties: {
        x: {
          type: 'union',
          refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */,
          description: 'X offset (0-1 relative to canvas)',
        },
        y: {
          type: 'union',
          refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */,
          description: 'Y offset (0-1 relative to canvas)',
        },
        scale: {
          type: 'union',
          refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */,
          description: 'Uniform scale (0-1, where 1 = 100%)',
        },
        rotation: {
          type: 'union',
          refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */,
          description: 'Rotation (0-1, where 1 = 360 degrees)',
        },
        anchorX: {
          type: 'union',
          refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */,
          description: 'Transform anchor X (0-1)',
        },
        anchorY: {
          type: 'union',
          refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */,
          description: 'Transform anchor Y (0-1)',
        },
      },
    },

    transform: {
      type: 'object',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'visual.transform' },
        enabled: { type: 'union', refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */ },
        params: { type: 'ref', ref: '#transform.params' },
      },
    },

    'opacity.params': {
      type: 'object',
      required: ['value'],
      properties: {
        value: {
          type: 'union',
          refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */,
          description: 'Opacity (0-100)',
        },
        blendMode: {
          type: 'ref',
          ref: 'app.eddy.project#staticBlendMode',
        },
      },
    },

    'brightness.params': {
      type: 'object',
      required: ['value'],
      properties: {
        value: {
          type: 'union',
          refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */,
          description: 'Brightness adjustment (-100 to 100, 0 = no change)',
        },
      },
    },

    'contrast.params': {
      type: 'object',
      required: ['value'],
      properties: {
        value: {
          type: 'union',
          refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */,
          description: 'Contrast multiplier (0-200, 100 = no change)',
        },
      },
    },

    'saturation.params': {
      type: 'object',
      required: ['value'],
      properties: {
        value: {
          type: 'union',
          refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */,
          description: 'Saturation multiplier (0-200, 100 = no change, 0 = grayscale)',
        },
      },
    },

    'colorize.params': {
      type: 'object',
      required: ['color'],
      properties: {
        color: {
          type: 'union',
          refs: ['app.eddy.project#staticVec3'] /* TODO: add 'app.eddy.project#curveVec3' back when curve system is implemented */,
          description: 'Tint color as RGB, each component 0-100 (e.g., [100, 0, 0] = red)',
        },
        intensity: {
          type: 'union',
          refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */,
          description: 'Colorize intensity (0 = original, 100 = full tint)',
        },
      },
    },

    opacity: {
      type: 'object',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'visual.opacity' },
        enabled: { type: 'union', refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */ },
        params: { type: 'ref', ref: '#opacity.params' },
      },
    },

    brightness: {
      type: 'object',
      description: 'Brightness adjustment effect',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'visual.brightness' },
        enabled: { type: 'union', refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */ },
        params: { type: 'ref', ref: '#brightness.params' },
      },
    },

    contrast: {
      type: 'object',
      description: 'Contrast adjustment effect',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'visual.contrast' },
        enabled: { type: 'union', refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */ },
        params: { type: 'ref', ref: '#contrast.params' },
      },
    },

    saturation: {
      type: 'object',
      description: 'Saturation adjustment effect',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'visual.saturation' },
        enabled: { type: 'union', refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */ },
        params: { type: 'ref', ref: '#saturation.params' },
      },
    },

    colorize: {
      type: 'object',
      description: 'Colorize/tint effect that blends a color over the image',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'visual.colorize' },
        enabled: { type: 'union', refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */ },
        params: { type: 'ref', ref: '#colorize.params' },
      },
    },

    custom: {
      type: 'object',
      description: 'Custom or third-party visual effect',
      required: ['type'],
      properties: {
        type: {
          type: 'string',
          description: "Custom effect identifier (e.g., 'visual.vendor.effectName')",
        },
        enabled: { type: 'union', refs: ['app.eddy.project#staticValue'] /* TODO: add 'app.eddy.project#curveRef' back when curve system is implemented */ },
        params: {
          type: 'ref',
          ref: 'app.eddy.project#customParams',
        },
      },
    },
  },
} as const satisfies LexiconDoc
