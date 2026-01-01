# Klip Lexicons

AT Protocol lexicon definitions for Klip.

## Core Principle: Everything is an Effect

Klip uses a unified effect-based architecture. All processing—audio mixing, video transforms, layout, filters—is modeled as effects in pipelines. This enables:

- **Unified automation**: Any parameter on any effect can be automated
- **Composable**: Stack effects in any order
- **Extensible**: New capabilities = new effect types
- **Remixable**: Remixer can modify any effect in the chain

## Records

### `app.klip.project`

The main project record containing groups, tracks, and effect pipelines.

- **Key**: `tid` (timestamp-based ID)
- **Stored on**: User's PDS

### `app.klip.stem`

A media stem (audio or video file) that can be used across multiple projects.

- **Key**: `tid`
- **Stored on**: User's PDS
- **Contains**: Blob reference to actual media file

## Architecture

```
project
├── canvas                    # Output dimensions
├── groups[]                  # Layout containers
│   ├── members[]             # Track/group references + position hints
│   └── pipeline[]            # Group effects (layout, visual, mask)
├── tracks[]                  # Media tracks
│   ├── clips[]               # Timeline regions
│   ├── audioPipeline[]       # Audio effects
│   └── videoPipeline[]       # Visual effects
├── masterAudioPipeline[]     # Master audio bus
└── masterVideoPipeline[]     # Master video output
```

## Effect Categories

### Audio Effects (`audio.*`)

Used in `track.audioPipeline` and `masterAudioPipeline`.

| Effect | Description |
|--------|-------------|
| `audio.gain` | Volume control |
| `audio.pan` | Stereo positioning |
| `audio.eq` | 3-band equalizer |
| `audio.compressor` | Dynamic range compression |
| `audio.reverb` | Reverberation |
| `audio.delay` | Echo/delay with feedback |
| `audio.filter` | Low/high/band-pass filtering |
| `audio.custom` | Third-party audio effects |

### Visual Effects (`visual.*`)

Used in `track.videoPipeline`, `group.pipeline`, and `masterVideoPipeline`.

| Effect | Description |
|--------|-------------|
| `visual.transform` | Position offset, scale, rotation |
| `visual.opacity` | Transparency and blend modes |
| `visual.crop` | Crop edges |
| `visual.colorCorrect` | Brightness, contrast, saturation, hue, temperature |
| `visual.blur` | Gaussian, box, or motion blur |
| `visual.sharpen` | Sharpening |
| `visual.custom` | Third-party visual effects |

### Group Effects (`group.*`)

Layout effects are **group-only**. Visual effects work on both tracks and groups.

| Effect | Description |
|--------|-------------|
| `group.layout.grid` | CSS Grid-like arrangement |
| `group.layout.stack` | Horizontal or vertical stack (flexbox-like) |
| `group.layout.absolute` | Manual x/y/w/h positioning |
| `group.layout.custom` | Third-party layout effects |
| `group.mask` | Mask group with shape or track |
| `visual.*` | All visual effects also work on groups |

## Processing Order

```
Track Processing:
  clip audio → track.audioPipeline → (to group)
  clip video → track.videoPipeline → (to group)

Group Processing:
  member tracks → group.pipeline (layout positions them, then visual effects)

Master Processing:
  all groups composited → masterVideoPipeline → output
  all audio mixed → masterAudioPipeline → output
```

## Examples

### MVP: Simple 4-Track Project

```json
{
  "title": "late night jam",
  "canvas": { "width": 1280, "height": 720 },
  "groups": [
    {
      "id": "main",
      "members": [
        { "id": "t1" },
        { "id": "t2" },
        { "id": "t3" },
        { "id": "t4" }
      ],
      "pipeline": [
        { "type": "group.layout.grid", "columns": 2, "rows": 2, "autoPlace": true }
      ]
    }
  ],
  "tracks": [
    {
      "id": "t1",
      "stem": { "uri": "at://did:plc:.../app.klip.stem/...", "cid": "..." },
      "clips": [{ "id": "c1", "offset": 0, "duration": 60000 }],
      "audioPipeline": [
        { "type": "audio.gain", "value": 1.0 },
        { "type": "audio.pan", "value": 0 }
      ],
      "videoPipeline": []
    }
  ],
  "createdAt": "2024-01-01T00:00:00Z"
}
```

### Explicit Grid Positions

```json
{
  "groups": [
    {
      "id": "main",
      "members": [
        { "id": "t1", "column": 1, "row": 1 },
        { "id": "t2", "column": 2, "row": 1, "rowSpan": 2 },
        { "id": "t3", "column": 1, "row": 2 }
      ],
      "pipeline": [
        { "type": "group.layout.grid", "columns": 2, "rows": 2 }
      ]
    }
  ]
}
```

### Picture-in-Picture with Effects

```json
{
  "groups": [
    {
      "id": "background",
      "members": [{ "id": "main-video" }],
      "pipeline": [
        { "type": "group.layout.grid", "columns": 1, "rows": 1 },
        { "type": "visual.blur", "radius": 10 },
        { "type": "visual.colorCorrect", "brightness": -0.2 }
      ]
    },
    {
      "id": "pip",
      "members": [
        { "id": "facecam", "x": 0.7, "y": 0.7, "width": 0.25, "height": 0.25 }
      ],
      "pipeline": [
        { "type": "group.layout.absolute" }
      ]
    }
  ],
  "tracks": [
    {
      "id": "facecam",
      "videoPipeline": [
        { "type": "visual.crop", "left": 0.1, "right": 0.1 },
        { "type": "visual.colorCorrect", "saturation": 1.2 }
      ]
    }
  ]
}
```

### Nested Groups

```json
{
  "groups": [
    {
      "id": "band",
      "members": [
        { "id": "drums" },
        { "id": "bass" },
        { "id": "guitar" }
      ],
      "pipeline": [
        { "type": "group.layout.stack", "direction": "horizontal", "gap": 0.02 }
      ]
    },
    {
      "id": "canvas",
      "members": [
        { "id": "main-video", "x": 0, "y": 0, "width": 0.7, "height": 1 },
        { "id": "band", "isGroup": true, "x": 0.7, "y": 0, "width": 0.3, "height": 1 }
      ],
      "pipeline": [
        { "type": "group.layout.absolute" }
      ]
    }
  ]
}
```

### Complex Audio Chain

```json
{
  "tracks": [
    {
      "id": "vocals",
      "audioPipeline": [
        { "type": "audio.filter", "filterType": "highpass", "frequency": 80 },
        { "type": "audio.eq", "lowGain": -2, "midGain": 3, "highGain": 1 },
        { "type": "audio.compressor", "threshold": -18, "ratio": 4, "attack": 10 },
        { "type": "audio.reverb", "wet": 0.2, "decay": 1.5 },
        { "type": "audio.gain", "value": 0.9 },
        { "type": "audio.pan", "value": 0 }
      ]
    }
  ],
  "masterAudioPipeline": [
    { "type": "audio.compressor", "threshold": -6, "ratio": 2 },
    { "type": "audio.gain", "value": 1.0 }
  ]
}
```

## Group Members

Members reference tracks or other groups with optional position hints:

```typescript
interface GroupMember {
  id: string;           // Track ID or group ID
  isGroup?: boolean;    // true if referencing a group

  // Grid layout hints (used by group.layout.grid)
  column?: number;      // 1-based column
  row?: number;         // 1-based row
  columnSpan?: number;  // Span multiple columns
  rowSpan?: number;     // Span multiple rows

  // Absolute layout hints (used by group.layout.absolute)
  x?: number;           // 0-1 relative position
  y?: number;
  width?: number;
  height?: number;

  // Common
  zIndex?: number;      // Layer order
  fit?: 'contain' | 'cover' | 'fill';
}
```

## Future Extensibility

### Automation (not yet implemented)

```json
{
  "curves": [
    {
      "id": "fade-in",
      "keyframes": [
        { "time": 0, "value": 0 },
        { "time": 1000, "value": 1 }
      ]
    }
  ],
  "automations": [
    {
      "targetTrackId": "t1",
      "effectIndex": 0,
      "param": "value",
      "curveId": "fade-in",
      "offset": 0
    }
  ]
}
```

### Additional Layout Types

The `group.layout.custom` effect allows third-party layouts:

```json
{
  "type": "group.layout.custom",
  "params": {
    "layoutType": "masonry",
    "columns": 3,
    "itemSpacing": 0.01
  }
}
```

### Reserved Effect Namespaces

- `audio.*` - Audio processing
- `visual.*` - Visual processing (shared between tracks and groups)
- `group.layout.*` - Layout algorithms (group-only)
- `group.mask` - Masking (group-only)
- `*.vendor.*` - Third-party effects (e.g., `audio.waves.h-reverb`)

## Validation

Use `@atproto/lexicon` to validate records:

```typescript
import { Lexicons } from '@atproto/lexicon'
import projectLexicon from './app.klip.project.json'
import stemLexicon from './app.klip.stem.json'

const lexicons = new Lexicons()
lexicons.add(projectLexicon)
lexicons.add(stemLexicon)

// Validate a project record
lexicons.assertValidRecord('app.klip.project', projectData)
```

## Schema Versioning

Both records include a `schemaVersion` field (default: 1) for future migration support. Clients should check this field and handle unknown versions gracefully.
