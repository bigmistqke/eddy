# Klip Lexicons

AT Protocol lexicon definitions for Klip.

## Records

### `app.klip.project`
The main project record containing tracks, layout, and mix settings.

- **Key**: `tid` (timestamp-based ID)
- **Stored on**: User's PDS
- **References**: `app.klip.stem` records via `strongRef`

### `app.klip.stem`
A media stem (audio or video file) that can be used across multiple projects.

- **Key**: `tid`
- **Stored on**: User's PDS
- **Contains**: Blob reference to actual media file

## Design Principles

### Layout System: Named Grids + Placement

**1. Define grids at project level** (stored in `project.grids`):
```json
{
  "grids": [
    { "id": "2x2", "columns": 2, "rows": 2, "gap": 0.02 },
    { "id": "solo", "columns": 1, "rows": 1 },
    { "id": "pip", "columns": 1, "rows": 1 }
  ],
  "defaultGridId": "2x2"
}
```

**2. Reference grid by ID in placements** (on `track.placement` or `clip.placement`):

Grid placement:
```json
{
  "type": "grid",
  "gridId": "2x2",
  "column": 1,
  "row": 1,
  "fit": "cover"
}
```

Absolute placement (for overlays, PiP, free-form):
```json
{
  "type": "absolute",
  "x": 0.7,
  "y": 0.7,
  "width": 0.25,
  "height": 0.25,
  "zIndex": 10,
  "fit": "contain"
}
```

### Layout Inheritance

```
project.defaultGridId  (fallback grid)
    ↓
track.placement        (default for track, references gridId)
    ↓
clip.placement         (override for this clip's time range)
```

**Example: Solo focus at 0:30**
```json
{
  "grids": [
    { "id": "2x2", "columns": 2, "rows": 2 },
    { "id": "solo", "columns": 1, "rows": 1 }
  ],
  "tracks": [
    {
      "id": "track1",
      "placement": { "type": "grid", "gridId": "2x2", "column": 1, "row": 1 },
      "clips": [
        { "offset": 0, "duration": 30000 },
        {
          "offset": 30000,
          "duration": 30000,
          "placement": { "type": "grid", "gridId": "solo", "column": 1, "row": 1 }
        }
      ]
    }
  ]
}
```

Track 1's second clip switches to "solo" grid = full screen.

**MVP simplification:**
- One clip per track, track.placement is enough
- Single grid definition, no runtime grid switching

### Why This Architecture

**Named grids = reusable + timeline-switchable:**
- Define grids once, reference everywhere
- Clips can switch gridId to change layout at any point in timeline
- Remixer can modify a grid definition, all references update

**Intent is preserved for remixing:**
- Grid definitions stored → remixer can add track 5, grid reflows
- Not baked into absolute coordinates

**Timeline-aware layouts:**
- Clips can reference different grids
- "Scene changes" just mean clips with different gridId

**Escape hatch for complex layouts:**
- `absolutePlacement` for anything grid can't do
- PiP overlays, rotated elements, artistic arrangements

**Extensible for future:**
- Grid `columns`/`rows` are integers now (equal sizing)
- Future: could be arrays for `["1fr", "2fr"]` or `[{fr:1}, {fixed:0.2}]`
- No schema break, just extend the type

### Future: Scene Graph

The reference-based pattern (grids by ID, stems by ref) is a foundation for a scene graph:

```
project
├── grids: [...]              # Layout definitions
├── groups: [...]             # NEW: Named groups
└── tracks: [...]             # Can reference groups

group
├── id: string
├── children: (trackId | groupId)[]
├── transform: { x, y, scale, rotation, opacity }
└── placement: gridPlacement | absolutePlacement
```

**Enables:**
- **Grouping**: Multiple tracks move/scale together
- **Nesting**: Group inside group (transforms cascade)
- **Instancing**: Same group referenced multiple times with different transforms
- **Masking**: Group as mask for another group

**Example: PiP with grouped background**
```json
{
  "groups": [
    {
      "id": "background-duo",
      "children": ["track1", "track2"],
      "placement": { "type": "grid", "gridId": "2x2", ... }
    }
  ],
  "tracks": [
    {
      "id": "pip-overlay",
      "placement": { "type": "absolute", "x": 0.7, "y": 0.7, ... }
    }
  ]
}
```

The "background-duo" group positions tracks 1+2 in a 2x2 grid, while "pip-overlay" floats on top.

**Not for MVP** - but the current schema doesn't block this evolution.

### Effects: Track-Level Only (for now)

Effects live on `track.mix.effects`, not on clips. Simpler mental model:

```
clip audio → track effects → master effects → output
```

Like a mixer: each channel (track) has its own effect chain. All clips on a track go through the same processing.

**Future:** If per-clip effects are needed, we can add `clip.effects` later. Schema is additive.

### Future: Automation

Automation = keyframed parameter changes over time. Following the reference pattern:

**1. Named curves (reusable):**
```json
{
  "curves": [
    {
      "id": "fade-in",
      "keyframes": [
        { "time": 0, "value": 0 },
        { "time": 1000, "value": 1 }
      ],
      "interpolation": "linear"
    },
    {
      "id": "fade-out",
      "keyframes": [
        { "time": 0, "value": 1 },
        { "time": 500, "value": 0 }
      ],
      "interpolation": "ease-out"
    }
  ]
}
```

**2. Automation bindings (connect curve to parameter):**
```json
{
  "automations": [
    {
      "targetTrackId": "track1",
      "param": "mix.gain",
      "curveId": "fade-in",
      "offset": 0
    },
    {
      "targetTrackId": "track1",
      "param": "placement.opacity",
      "curveId": "fade-out",
      "offset": 55000
    }
  ]
}
```

**Automatable parameters:**

| Category | Parameter | Description |
|----------|-----------|-------------|
| Audio | `mix.gain` | Volume envelope |
| Audio | `mix.pan` | Stereo position |
| Audio | `mix.effects[n].params.*` | Any effect param |
| Video | `placement.x` | Horizontal position |
| Video | `placement.y` | Vertical position |
| Video | `placement.width` | Width (or scale) |
| Video | `placement.height` | Height (or scale) |
| Video | `placement.rotation` | Rotation |
| Video | `placement.opacity` | Transparency |

**Why references for automation:**
- Same curve reused (fade-in on multiple tracks)
- Remixer tweaks curve → all bindings update
- Curves are first-class, inspectable, editable
- `offset` allows same curve at different times

**Not for MVP** - but schema should not block this. Current params are static values; later they can coexist with automation bindings.

### Preset Examples

Client presets create grids and assign placements:

| Preset | Creates Grid | Track Placements |
|--------|--------------|------------------|
| 2x2 | `{id:"2x2", columns:2, rows:2}` | gridId:"2x2" at (1,1), (2,1), (1,2), (2,2) |
| Stack | `{id:"stack", columns:1, rows:4}` | gridId:"stack" at row 1, 2, 3, 4 |
| PiP | `{id:"main", columns:1, rows:1}` | Track 1: grid "main", Track 2: absolute overlay |
| Single | `{id:"single", columns:1, rows:1}` | Active track uses grid, others get absolute(0,0,0,0) |

### Track vs Stem Separation

**Stem** = the raw media file (reusable)
**Track** = how a stem is used in a project (positioning, timing, effects)

This allows:
- Same stem in multiple projects
- Same stem multiple times in one project (different clips)
- Remix without re-uploading media

### Future Extensibility

Reserved for future versions:

- `track.automation[]` - Parameter automation curves
- `track.group` - Track grouping/folders
- `clip.speed` - Playback speed/time stretch
- `clip.reverse` - Reverse playback
- `layout.mask` - Clip masking/shapes
- `layout.blend` - Blend modes
- `effect.type` values for specific effects (reverb, eq, filter, etc.)

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
