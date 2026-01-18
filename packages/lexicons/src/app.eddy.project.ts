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
            refs: ['#audioEffect.pan', '#audioEffect.gain', '#audioEffect.reverb', '#audioEffect.custom'],
          },
          maxLength: 16,
          description: 'Group-level audio effect chain',
        },
        videoPipeline: {
          type: 'array',
          items: {
            type: 'union',
            refs: ['#visualEffect.transform', '#visualEffect.opacity', '#visualEffect.brightness', '#visualEffect.contrast', '#visualEffect.saturation', '#visualEffect.colorize', '#visualEffect.custom'],
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
            refs: ['#audioEffect.pan', '#audioEffect.gain', '#audioEffect.reverb', '#audioEffect.custom'],
          },
          maxLength: 16,
          description: 'Track-level audio effect chain',
        },
        videoPipeline: {
          type: 'array',
          items: {
            type: 'union',
            refs: ['#visualEffect.transform', '#visualEffect.opacity', '#visualEffect.brightness', '#visualEffect.contrast', '#visualEffect.saturation', '#visualEffect.colorize', '#visualEffect.custom'],
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
            refs: ['#audioEffect.pan', '#audioEffect.gain', '#audioEffect.reverb', '#audioEffect.custom'],
          },
          maxLength: 16,
          description: 'Clip-level audio effects (curves are clip-relative)',
        },
        videoPipeline: {
          type: 'array',
          items: {
            type: 'union',
            refs: ['#visualEffect.transform', '#visualEffect.opacity', '#visualEffect.brightness', '#visualEffect.contrast', '#visualEffect.saturation', '#visualEffect.colorize', '#visualEffect.custom'],
          },
          maxLength: 16,
          description: 'Clip-level video effects (curves are clip-relative)',
        },
      },
    },

    // Audio effect params defs
    'audioEffect.gain.params': {
      type: 'object',
      required: ['value'],
      properties: {
        value: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Volume (0-100, where 100 = unity gain)',
        },
      },
    },

    'audioEffect.pan.params': {
      type: 'object',
      required: ['value'],
      properties: {
        value: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Stereo position (0 = left, 50 = center, 100 = right)',
        },
      },
    },

    'audioEffect.reverb.params': {
      type: 'object',
      properties: {
        mix: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Wet/dry mix (0 = dry, 100 = wet)',
        },
        decay: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Decay time scaled by 100 (e.g., 200 = 2 seconds)',
        },
        preDelay: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Pre-delay in milliseconds (0-100)',
        },
      },
    },

    'audioEffect.gain': {
      type: 'object',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'audio.gain' },
        enabled: { type: 'union', refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */ },
        params: { type: 'ref', ref: '#audioEffect.gain.params' },
      },
    },

    'audioEffect.pan': {
      type: 'object',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'audio.pan' },
        enabled: { type: 'union', refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */ },
        params: { type: 'ref', ref: '#audioEffect.pan.params' },
      },
    },

    'audioEffect.custom': {
      type: 'object',
      description: 'Custom or third-party audio effect',
      required: ['type'],
      properties: {
        type: {
          type: 'string',
          description: "Custom effect identifier (e.g., 'audio.vendor.effectName')",
        },
        enabled: { type: 'union', refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */ },
      },
    },

    'audioEffect.reverb': {
      type: 'object',
      description: 'Convolution-based reverb effect with wet/dry mix',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'audio.reverb' },
        enabled: { type: 'union', refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */ },
        params: { type: 'ref', ref: '#audioEffect.reverb.params' },
      },
    },

    // Visual effect params defs
    'visualEffect.transform.params': {
      type: 'object',
      properties: {
        x: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'X offset (0-1 relative to canvas)',
        },
        y: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Y offset (0-1 relative to canvas)',
        },
        scale: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Uniform scale (0-1, where 1 = 100%)',
        },
        rotation: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Rotation (0-1, where 1 = 360 degrees)',
        },
        anchorX: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Transform anchor X (0-1)',
        },
        anchorY: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Transform anchor Y (0-1)',
        },
      },
    },

    'visualEffect.transform': {
      type: 'object',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'visual.transform' },
        enabled: { type: 'union', refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */ },
        params: { type: 'ref', ref: '#visualEffect.transform.params' },
      },
    },

    'visualEffect.opacity.params': {
      type: 'object',
      required: ['value'],
      properties: {
        value: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Opacity (0-100)',
        },
        blendMode: {
          type: 'string',
          enum: ['normal', 'multiply', 'screen', 'overlay', 'add'],
          default: 'normal',
        },
      },
    },

    'visualEffect.brightness.params': {
      type: 'object',
      required: ['value'],
      properties: {
        value: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Brightness adjustment (-100 to 100, 0 = no change)',
        },
      },
    },

    'visualEffect.contrast.params': {
      type: 'object',
      required: ['value'],
      properties: {
        value: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Contrast multiplier (0-200, 100 = no change)',
        },
      },
    },

    'visualEffect.saturation.params': {
      type: 'object',
      required: ['value'],
      properties: {
        value: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Saturation multiplier (0-200, 100 = no change, 0 = grayscale)',
        },
      },
    },

    'visualEffect.colorize.params': {
      type: 'object',
      required: ['color'],
      properties: {
        color: {
          type: 'union',
          refs: ['#staticVec3'] /* TODO: add '#curveVec3' back when curve system is implemented */,
          description: 'Tint color as RGB, each component 0-100 (e.g., [100, 0, 0] = red)',
        },
        intensity: {
          type: 'union',
          refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */,
          description: 'Colorize intensity (0 = original, 100 = full tint)',
        },
      },
    },

    'visualEffect.opacity': {
      type: 'object',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'visual.opacity' },
        enabled: { type: 'union', refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */ },
        params: { type: 'ref', ref: '#visualEffect.opacity.params' },
      },
    },

    'visualEffect.brightness': {
      type: 'object',
      description: 'Brightness adjustment effect',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'visual.brightness' },
        enabled: { type: 'union', refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */ },
        params: { type: 'ref', ref: '#visualEffect.brightness.params' },
      },
    },

    'visualEffect.contrast': {
      type: 'object',
      description: 'Contrast adjustment effect',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'visual.contrast' },
        enabled: { type: 'union', refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */ },
        params: { type: 'ref', ref: '#visualEffect.contrast.params' },
      },
    },

    'visualEffect.saturation': {
      type: 'object',
      description: 'Saturation adjustment effect',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'visual.saturation' },
        enabled: { type: 'union', refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */ },
        params: { type: 'ref', ref: '#visualEffect.saturation.params' },
      },
    },

    'visualEffect.colorize': {
      type: 'object',
      description: 'Colorize/tint effect that blends a color over the image',
      required: ['type', 'params'],
      properties: {
        type: { type: 'string', const: 'visual.colorize' },
        enabled: { type: 'union', refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */ },
        params: { type: 'ref', ref: '#visualEffect.colorize.params' },
      },
    },

    'visualEffect.custom': {
      type: 'object',
      description: 'Custom or third-party visual effect',
      required: ['type'],
      properties: {
        type: {
          type: 'string',
          description: "Custom effect identifier (e.g., 'visual.vendor.effectName')",
        },
        enabled: { type: 'union', refs: ['#staticValue'] /* TODO: add '#curveRef' back when curve system is implemented */ },
        params: {
          type: 'unknown',
          description: 'Effect-specific parameters',
        },
      },
    },
  },
} as const satisfies LexiconDoc
