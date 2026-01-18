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
            items: { type: 'union', refs: ['#curve.keyframe', '#curve.envelope', '#curve.lfo'] },
            maxLength: 256,
            description:
              'Reusable animation curves. Each curve has a unique id field; validators must reject duplicates. Runtime may convert to map for O(1) lookup.',
          },
          groups: {
            type: 'array',
            items: { type: 'ref', ref: '#group' },
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
            items: { type: 'ref', ref: '#track' },
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

    'curve.keyframe': {
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
          items: { type: 'ref', ref: '#keyframePoint' },
          minLength: 1,
          maxLength: 256,
        },
      },
    },

    keyframePoint: {
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

    'curve.envelope': {
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
          ref: '#envelopePhase',
          description: 'Attack phase: 0 to peak',
        },
        decay: {
          type: 'ref',
          ref: '#envelopePhase',
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
          ref: '#envelopePhase',
          description: 'Release phase: sustain to 0',
        },
        peak: {
          type: 'integer',
          description: 'Peak value at end of attack',
          default: 1,
        },
      },
    },

    envelopePhase: {
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

    'curve.lfo': {
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

    staticValue: {
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

    staticVec2: {
      type: 'object',
      description:
        "A static 2D vector. Each component is an integer scaled by 100 (e.g., [50, 100] = [0.5, 1.0]).",
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

    staticVec3: {
      type: 'object',
      description:
        "A static 3D vector. Each component is an integer scaled by 100 (e.g., [100, 50, 0] = [1.0, 0.5, 0.0]).",
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

    staticVec4: {
      type: 'object',
      description:
        "A static 4D vector. Each component is an integer scaled by 100 (e.g., [100, 50, 0, 100] = [1.0, 0.5, 0.0, 1.0]).",
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

    staticBlendMode: {
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

    /* TODO: Add matrix types when needed (staticMat2, staticMat3, staticMat4) */

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
            refs: ['app.eddy.audioEffect#pan', 'app.eddy.audioEffect#gain', 'app.eddy.audioEffect#reverb', 'app.eddy.audioEffect#custom'],
          },
          maxLength: 16,
          description: 'Group-level audio effect chain',
        },
        videoPipeline: {
          type: 'array',
          items: {
            type: 'union',
            refs: ['app.eddy.visualEffect#transform', 'app.eddy.visualEffect#opacity', 'app.eddy.visualEffect#brightness', 'app.eddy.visualEffect#contrast', 'app.eddy.visualEffect#saturation', 'app.eddy.visualEffect#colorize', 'app.eddy.visualEffect#custom'],
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
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Gap between cells (0-1 relative to group size)',
        },
        padding: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Padding around grid (0-1 relative to group size)',
        },
      },
    },

    track: {
      type: 'object',
      description: 'A track containing media clips and effect pipelines',
      required: ['id', 'clips'],
      properties: {
        id: {
          type: 'string',
          maxLength: 64,
        },
        name: {
          type: 'string',
          maxLength: 128,
        },
        clips: {
          type: 'array',
          items: { type: 'ref', ref: '#clip' },
          maxLength: 256,
        },
        audioPipeline: {
          type: 'array',
          items: {
            type: 'union',
            refs: ['app.eddy.audioEffect#pan', 'app.eddy.audioEffect#gain', 'app.eddy.audioEffect#reverb', 'app.eddy.audioEffect#custom'],
          },
          maxLength: 16,
          description: 'Track-level audio effect chain',
        },
        videoPipeline: {
          type: 'array',
          items: {
            type: 'union',
            refs: ['app.eddy.visualEffect#transform', 'app.eddy.visualEffect#opacity', 'app.eddy.visualEffect#brightness', 'app.eddy.visualEffect#contrast', 'app.eddy.visualEffect#saturation', 'app.eddy.visualEffect#colorize', 'app.eddy.visualEffect#custom'],
          },
          maxLength: 16,
          description: 'Track-level video effect chain',
        },
        muted: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Mute track',
        },
        solo: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Solo track',
        },
      },
    },

    'clipSource.stem': {
      type: 'object',
      description: 'Reference to an external stem record',
      required: ['type', 'ref'],
      properties: {
        type: { type: 'string', const: 'stem' },
        ref: {
          type: 'ref',
          ref: 'com.atproto.repo.strongRef',
          description: 'Reference to app.eddy.stem record',
        },
      },
    },

    'clipSource.group': {
      type: 'object',
      description: 'Reference to a group within this project (for nested compositions)',
      required: ['type', 'id'],
      properties: {
        type: { type: 'string', const: 'group' },
        id: {
          type: 'string',
          description: 'ID of the group to use as source',
          maxLength: 64,
        },
      },
    },

    clip: {
      type: 'object',
      description: 'A region on the timeline referencing part of a stem or group',
      required: ['id', 'offset', 'duration'],
      properties: {
        id: {
          type: 'string',
          maxLength: 64,
        },
        source: {
          type: 'union',
          refs: ['#clipSource.stem', '#clipSource.group'],
          description: 'Source media: a stem reference or a nested group',
        },
        offset: {
          type: 'integer',
          description: 'Position on timeline in milliseconds',
          minimum: 0,
        },
        sourceOffset: {
          type: 'integer',
          description: 'Start position within source stem (for trimming)',
          minimum: 0,
          default: 0,
        },
        duration: {
          type: 'integer',
          description: 'Duration in milliseconds',
          minimum: 0,
        },
        speed: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Playback speed multiplier (0.1-10)',
        },
        reverse: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Play clip in reverse',
        },
        audioPipeline: {
          type: 'array',
          items: {
            type: 'union',
            refs: ['app.eddy.audioEffect#pan', 'app.eddy.audioEffect#gain', 'app.eddy.audioEffect#reverb', 'app.eddy.audioEffect#custom'],
          },
          maxLength: 16,
          description: 'Clip-level audio effects (curves are clip-relative)',
        },
        videoPipeline: {
          type: 'array',
          items: {
            type: 'union',
            refs: ['app.eddy.visualEffect#transform', 'app.eddy.visualEffect#opacity', 'app.eddy.visualEffect#brightness', 'app.eddy.visualEffect#contrast', 'app.eddy.visualEffect#saturation', 'app.eddy.visualEffect#colorize', 'app.eddy.visualEffect#custom'],
          },
          maxLength: 16,
          description: 'Clip-level video effects (curves are clip-relative)',
        },
      },
    },
  },
} as const satisfies LexiconDoc
