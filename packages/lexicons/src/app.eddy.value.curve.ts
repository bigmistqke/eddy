import type { LexiconDoc } from '@atproto/lexicon'

export default {
  lexicon: 1,
  id: 'app.eddy.value.curve',
  defs: {
    keyframe: {
      type: 'object',
      description: 'Explicit keyframe curve with bezier interpolation',
      required: ['type', 'id', 'points'],
      properties: {
        type: { type: 'string', const: 'keyframe' },
        id: {
          type: 'string',
          description: 'Unique identifier for this curve',
          maxLength: 64,
        },
        points: {
          type: 'array',
          items: { type: 'ref', ref: '#keyframe.point' },
          minLength: 1,
          maxLength: 256,
        },
      },
    },

    'keyframe.point': {
      type: 'object',
      description: 'A point in a keyframe curve',
      required: ['t', 'v'],
      properties: {
        t: {
          type: 'integer',
          description: 'Time in milliseconds',
        },
        v: {
          type: 'integer',
          description: 'Value at this point',
        },
        in: {
          type: 'array',
          description: 'Incoming bezier handle [x, y] relative to point',
          items: { type: 'integer' },
          minLength: 2,
          maxLength: 2,
        },
        out: {
          type: 'array',
          description: 'Outgoing bezier handle [x, y] relative to point',
          items: { type: 'integer' },
          minLength: 2,
          maxLength: 2,
        },
      },
    },

    envelope: {
      type: 'object',
      description: 'ADSR envelope generator',
      required: ['type', 'id'],
      properties: {
        type: { type: 'string', const: 'envelope' },
        id: {
          type: 'string',
          maxLength: 64,
        },
        attack: {
          type: 'ref',
          ref: '#envelope.phase',
          description: 'Attack phase: 0 to peak',
        },
        decay: {
          type: 'ref',
          ref: '#envelope.phase',
          description: 'Decay phase: peak to sustain',
        },
        sustain: {
          type: 'integer',
          description: 'Sustain level (0-1)',
          minimum: 0,
          maximum: 1,
          default: 1,
        },
        release: {
          type: 'ref',
          ref: '#envelope.phase',
          description: 'Release phase: sustain to 0',
        },
        peak: {
          type: 'integer',
          description: 'Peak value at end of attack',
          default: 1,
        },
      },
    },

    'envelope.phase': {
      type: 'object',
      description: 'A phase of an envelope with duration and curve',
      required: ['duration'],
      properties: {
        duration: {
          type: 'integer',
          description: 'Phase duration in milliseconds',
          minimum: 0,
        },
        curve: {
          type: 'array',
          description: 'Bezier control points [x1, y1, x2, y2]',
          items: { type: 'integer' },
          minLength: 4,
          maxLength: 4,
        },
      },
    },

    lfo: {
      type: 'object',
      description:
        'Low-frequency oscillator. Must have either frequency (Hz) or sync (beat division).',
      required: ['type', 'id'],
      properties: {
        type: { type: 'string', const: 'lfo' },
        id: {
          type: 'string',
          maxLength: 64,
        },
        waveform: {
          type: 'string',
          enum: ['sine', 'triangle', 'square', 'sawtooth'],
          default: 'sine',
        },
        frequency: {
          type: 'integer',
          description: 'Oscillation frequency in Hz. Ignored if sync is set.',
          minimum: 0.01,
          maximum: 100,
        },
        sync: {
          type: 'string',
          description: 'Beat division synced to project BPM. Overrides frequency when set.',
          enum: ['4/1', '2/1', '1/1', '1/2', '1/4', '1/8', '1/16', '1/32'],
        },
        amplitude: {
          type: 'integer',
          description: 'Oscillation amplitude (0-1)',
          minimum: 0,
          maximum: 1,
          default: 1,
        },
        center: {
          type: 'integer',
          description: 'Center value to oscillate around (0-1)',
          minimum: 0,
          maximum: 1,
          default: 0.5,
        },
        phase: {
          type: 'integer',
          description: 'Phase offset in degrees',
          minimum: 0,
          maximum: 360,
          default: 0,
        },
      },
    },

    /* TODO: Re-enable when curve system is implemented
    curveRef: {
      type: 'object',
      description: 'Reference to a curve with output scaling. Values scaled by 100.',
      required: ['curve'],
      properties: {
        curve: {
          type: 'string',
          description: 'ID of the curve to reference. Must match an id in project.curves array.',
          maxLength: 64,
        },
        min: {
          type: 'integer',
          description: 'Minimum output value scaled by 100 (curve 0 maps to this)',
          default: 0,
        },
        max: {
          type: 'integer',
          description: 'Maximum output value scaled by 100 (curve 1 maps to this)',
          default: 100,
        },
        offset: {
          type: 'integer',
          description: 'Time offset in milliseconds',
          default: 0,
        },
        timeScale: {
          type: 'integer',
          description: 'Time multiplier scaled by 100 (200 = 2x speed)',
          default: 100,
        },
        timeRef: {
          type: 'string',
          enum: ['clip', 'project'],
          description: 'Time reference: clip-relative or project-relative',
          default: 'clip',
        },
      },
    },
    */
  },
} as const satisfies LexiconDoc
