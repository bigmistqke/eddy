# Klip MVP

Minimal viable product: a 4-track recorder for the AT Protocol era.

## Philosophy

Think Tascam Portastudio, not Pro Tools. The constraint is the feature. Four tracks forces decisions, encourages simplicity, makes collaboration lightweight. You can always bounce and free up tracks—just like tape.

## What It Is

- 4 audio/video tracks
- Record, import, arrange
- Simple mixing (volume, pan)
- Publish to AT Protocol
- Fork and remix others

## What It Isn't

- No transitions
- No effects (EQ, reverb, etc.)
- No MIDI
- No automation
- No fancy timeline scrubbing
- No real-time collaboration

These come later. MVP ships without them.

## Core User Flows

### Flow 1: Create

```
┌─────────────────────────────────────────┐
│              New Project                │
│                                         │
│  Track 1: [Record] [Import] [________]  │
│  Track 2: [Record] [Import] [________]  │
│  Track 3: [Record] [Import] [________]  │
│  Track 4: [Record] [Import] [________]  │
│                                         │
│  ▶ Play    ⏹ Stop    [Publish]         │
└─────────────────────────────────────────┘
```

1. Tap "New Project"
2. For each track: record via mic/camera OR import from camera roll
3. Drag to adjust timing (simple waveform/thumbnail view)
4. Set levels with sliders
5. Tap "Publish" → goes to your PDS

### Flow 2: Remix

```
┌─────────────────────────────────────────┐
│  @someone's project                     │
│  "late night jam"                       │
│                                         │
│  ▶ [Play]     [Remix]     [♡ Like]     │
│                                         │
│  Remixed from: @original               │
│  Remixed by: @person1, @person2        │
└─────────────────────────────────────────┘
```

1. Browse feed / search
2. Play someone's project
3. Tap "Remix"
4. All 4 stems clone to your account
5. Replace/add/mute tracks
6. Publish (auto-links to original)

### Flow 3: Discover

- Feed of projects from people you follow
- Simple search by username
- View remix chains (who remixed who)

### Flow 4: Post to Bluesky

Critical for testing and buzz-building. Every Klip project can be rendered and posted as a native Bluesky video.

```
┌─────────────────────────────────────────┐
│           Share to Bluesky              │
│                                         │
│  Preview: [▶ 0:32 video thumbnail]     │
│                                         │
│  Caption:                               │
│  ┌─────────────────────────────────┐   │
│  │ late night jam 🎵               │   │
│  │                                  │   │
│  └─────────────────────────────────┘   │
│                                         │
│  ☑ Include "Made with Klip" link       │
│  ☑ Link to remixable project           │
│                                         │
│  [Cancel]              [Post to 🦋]    │
└─────────────────────────────────────────┘
```

**The flow:**
1. Tap "Share" on any project
2. Klip renders composite video (all tracks mixed down)
3. Preview before posting
4. Add caption (pre-filled with project title)
5. Post uploads video to Bluesky's CDN
6. Post text includes link back to Klip project

**Post format:**
```
late night jam 🎵

🔗 Remix this: https://klip.app/p/did:plc:xxx/rkey

Made with Klip
```

**Technical:**
- Render to MP4 (H.264 + AAC for max Bluesky compatibility)
- Max 3 minutes, 720p (fits Bluesky limits)
- Use `app.bsky.feed.post` with `app.bsky.embed.video`
- Include facet link to Klip project URL
- Klip project URL resolves to web player + "Open in Klip" button

## Technical Scope

### Data Model

Full lexicon definitions in `lexicons/` directory:
- `app.klip.project.json` - Project with tracks, layout, and mix settings
- `app.klip.stem.json` - Reusable media stems

**Key design decisions:**

| Feature | Data Model | MVP UI |
|---------|------------|--------|
| Tracks | Unlimited (max 32) | 4 slots |
| Clips per track | Unlimited (max 256) | 1 clip (start from t=0) |
| Layout | Absolute positioning (x,y,w,h) | Preset picker (grid, stack, etc) |
| Effects | Full effect chain arrays | Ignored |
| Mix | Gain, pan, effects | Gain + pan only |

**Why absolute positioning for layout:**
- Presets are client-side conveniences, not stored in schema
- User picks "Grid 2x2" → client computes x/y/w/h → saves absolute values
- Future: drag to reposition, pinch to resize, no schema changes needed
- Projects portable between clients with different preset libraries

**Stem reuse:**
- Stems are separate records, referenced by `strongRef`
- Same stem can appear in multiple projects
- Remixing = clone project record, keep stem references
- Only re-upload if you modify the actual media

### File Formats

**Audio stems:**
- Codec: Opus
- Container: WebM or OGG
- Bitrate: 128kbps (good quality, reasonable size)
- Sample rate: 48kHz

**Video stems:**
- Codec: H.264 (widest compatibility) or VP9 (better compression)
- Container: MP4 or WebM
- Resolution: 720p max for MVP
- Audio: Opus track embedded

**Size budget per project:**
- 4 stems × ~10MB each = ~40MB max
- Fits within 50MB PDS blob limit
- 60-90 seconds of content at good quality

### Rendering Pipeline

For Bluesky posting, we need to composite all tracks into a single video file.

```
┌─────────────────────────────────────────────────────────────────┐
│                       Render Pipeline                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│   VIDEO PATH                         AUDIO PATH                  │
│   ──────────                         ──────────                  │
│                                                                  │
│   ┌──────────┐                ┌──────────┐  ┌──────────┐        │
│   │ Track 1  │                │ Track 2  │  │ Track 3  │  ...   │
│   │ (video)  │                │ (audio)  │  │ (audio)  │        │
│   └────┬─────┘                └────┬─────┘  └────┬─────┘        │
│        │                           │             │               │
│        │ decode frames             │             │               │
│        ▼                           ▼             ▼               │
│   ┌─────────┐                ┌─────────────────────────────┐    │
│   │ Canvas  │                │      Web Audio API          │    │
│   │ 2D/WebGL│                │  ┌─────┐ ┌─────┐ ┌─────┐   │    │
│   └────┬────┘                │  │Gain │ │Gain │ │Gain │   │    │
│        │                     │  │+Pan │ │+Pan │ │+Pan │   │    │
│        │                     │  └──┬──┘ └──┬──┘ └──┬──┘   │    │
│        │                     │     └───────┼───────┘      │    │
│        │                     │             ▼              │    │
│        │                     │        ┌─────────┐         │    │
│        │                     │        │ Master  │         │    │
│        │                     │        │  Bus    │         │    │
│        │                     │        └────┬────┘         │    │
│        │                     └─────────────┼──────────────┘    │
│        │                                   │                    │
│        │ captureStream()                   │ createMediaStream- │
│        │                                   │ Destination()      │
│        ▼                                   ▼                    │
│   ┌─────────┐                        ┌─────────┐               │
│   │ Video   │                        │ Audio   │               │
│   │ Stream  │                        │ Stream  │               │
│   └────┬────┘                        └────┬────┘               │
│        │                                  │                     │
│        └──────────────┬───────────────────┘                     │
│                       ▼                                         │
│              ┌─────────────────┐                                │
│              │ MediaRecorder   │  ← real-time capture           │
│              │ (WebM/VP8+Opus) │                                │
│              └────────┬────────┘                                │
│                       │                                         │
│                       ▼                                         │
│              ┌─────────────────┐                                │
│              │ WebCodecs +     │  ← re-encode for Bluesky       │
│              │ mp4box.js       │    (H.264 + AAC in MP4)        │
│              └────────┬────────┘                                │
│                       │                                         │
│                       ▼                                         │
│              ┌─────────────────┐                                │
│              │   Final MP4     │                                │
│              └─────────────────┘                                │
└─────────────────────────────────────────────────────────────────┘
```

**Two parallel paths:**
1. **Video** → Canvas → `captureStream()` → video MediaStream
2. **Audio** → Web Audio (gain/pan per track → master bus) → `MediaStreamDestination` → audio MediaStream

**Combined into final output:**
- MediaRecorder captures both streams (quick but WebM only)
- WebCodecs + mp4box.js re-encodes to MP4 (H.264+AAC) for Bluesky compatibility

**Alternative: Offline render (faster than realtime)**
- Skip MediaRecorder entirely
- Decode frames manually with WebCodecs
- Process audio in chunks with OfflineAudioContext
- Encode directly to H.264/AAC with WebCodecs
- Mux with mp4box.js

**For MVP:**
- 4 video slots rendered as a grid (2x2 or 1x4 depending on aspect ratio)
- Each track can be video (with audio) or audio-only (show waveform/color in slot)
- Recording happens in-app: record yourself while hearing/seeing other tracks
- MVP constraint: each recording starts from t=0 (one continuous take per slot)
- Future: stop/start recording = multiple clips per track

**Layout system:**

Underlying model is always absolute positioning (x, y, width, height, z-index). Auto-layouts are just presets that generate these values.

```
MVP: Simple layout presets
┌─────────────────────────────────────────┐
│  [Grid 2x2]  [Stack]  [Single]  [Free]  │
└─────────────────────────────────────────┘

Future: Full positioning control
- Drag to reposition
- Pinch to resize
- Layer order controls
- Grouping/nesting
```

This keeps MVP simple (pick a preset) while the data model supports full flexibility later. See `lexicons/` for schema details.

### Client Tech Stack

```
┌──────────────────────────────────────────┐
│             Klip MVP                      │
├──────────────────────────────────────────┤
│  SolidJS                                 │
│  - Reactive, fast, small bundle          │
│  - Good mobile perf                      │
├──────────────────────────────────────────┤
│  @anthropic/atproto-api                  │
│  - OAuth login                           │
│  - Blob upload                           │
│  - Record CRUD                           │
├──────────────────────────────────────────┤
│  Web Audio API                           │
│  - Playback                              │
│  - Recording (MediaRecorder)             │
│  - Simple mixing (gain nodes)            │
├──────────────────────────────────────────┤
│  mp4box.js (your TS version)             │
│  - Parse imported video                  │
│  - Extract audio for waveforms           │
│  - Mux final export                      │
├──────────────────────────────────────────┤
│  WebCodecs (with fallback)               │
│  - Encode/decode video frames            │
│  - Falls back to ffmpeg.wasm if needed   │
└──────────────────────────────────────────┘
```

### What We Skip for MVP

| Feature | Why Skip |
|---------|----------|
| Effects | Complexity, CPU usage, can add later |
| MIDI | Niche, requires synth engine |
| Automation | Overkill for 4-track |
| Offline sync | Just require internet for now |
| Comments | Nice-to-have, not core |
| Video transitions | Scope creep |
| Waveform editing | Just drag whole clips |

## UI Concept

Mobile-first. One hand operation where possible.

```
┌─────────────────────────────────┐
│ ☰  Klip            [@handle ▼] │
├─────────────────────────────────┤
│                                 │
│  ┌─────────────────────────┐   │
│  │ 🎥 Track 1    [≡][-][M] │   │  <- Video track
│  │ ████████░░░░░░░░░░░░░░░ │   │     Thumbnail strip
│  └─────────────────────────┘   │
│                                 │
│  ┌─────────────────────────┐   │
│  │ 🎤 Track 2    [≡][-][M] │   │  <- Audio track
│  │ ▃▅▇▅▃▁▃▅▇█▇▅▃▁▃▅▇▅▃▁▃▅ │   │     Waveform
│  └─────────────────────────┘   │
│                                 │
│  ┌─────────────────────────┐   │
│  │ 🎸 Track 3    [≡][-][M] │   │
│  │ ▁▃▅▃▁▃▅▇▅▃▁▃▅▇█▇▅▃▁▃▅▃ │   │
│  └─────────────────────────┘   │
│                                 │
│  ┌─────────────────────────┐   │
│  │ + Track 4              │   │  <- Empty slot
│  │   [Record] [Import]     │   │
│  └─────────────────────────┘   │
│                                 │
├─────────────────────────────────┤
│ ◀◀  ▶ PLAY   ▶▶    0:24/1:30  │
├─────────────────────────────────┤
│ [Save Draft]      [Publish →]  │
└─────────────────────────────────┘

[≡] = Volume slider (tap to expand)
[-] = Pan (tap to expand)
[M] = Mute toggle
```

## Remix Attribution

When you remix, the chain is visible:

```
your-remix
  └── remixed from: @someone/original-track
        └── remixed from: @creator/first-version
```

This is just following `parent` references. No special indexing needed for MVP.

## Authentication

Use AT Protocol OAuth flow:
1. User taps "Sign in with Bluesky"
2. Redirects to Bluesky OAuth
3. Returns with credentials
4. Store session, make authenticated requests

No custom auth, no passwords to manage.

## Hosting / Deployment

**MVP deployment:**
- Static site (Vercel, Netlify, Cloudflare Pages)
- No backend needed—everything goes to user's PDS
- Just HTML/JS/CSS

**Domain:**
- klip.audio? klip.fm? getklip.app?

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| PDS storage limits tighten | Compress aggressively, consider self-host PDS docs |
| Bluesky OAuth changes | Follow their developer channels closely |
| WebCodecs not supported | ffmpeg.wasm fallback (slower but works) |
| Mobile browser audio quirks | Test heavily on iOS Safari, Chrome Android |
| Copyright abuse | Clear remix attribution, respond to DMCA |

## Success Metrics

MVP is successful if:
- [ ] Can create a 4-track project in under 2 minutes
- [ ] Can remix someone else's project
- [ ] Remix chain is visible
- [ ] Works on iPhone Safari and Android Chrome
- [ ] Project loads in under 3 seconds on 4G

## Development Phases

### Phase 1: Proof of Concept
- [ ] AT Protocol OAuth login working
- [ ] Upload a single audio blob to PDS
- [ ] Retrieve and play it back
- [ ] Basic project record creation

### Phase 2: Core Editor
- [ ] 4-track timeline UI
- [ ] Record audio via MediaRecorder
- [ ] Import from file picker
- [ ] Waveform visualization
- [ ] Playback with Web Audio mixing

### Phase 3: Video Support
- [ ] Import video clips
- [ ] Thumbnail strip visualization
- [ ] Video playback synced with audio
- [ ] mp4box.js integration for parsing

### Phase 4: Publishing to PDS
- [ ] Encode stems to Opus/H.264
- [ ] Upload stems as separate blobs
- [ ] Create project record with lexicon
- [ ] Retrieve and display published projects

### Phase 5: Bluesky Posting (Critical for Testing)
- [ ] Render composite video (mix all tracks)
- [ ] Offline render with WebCodecs + mp4box.js
- [ ] Upload to Bluesky video CDN
- [ ] Create post with video embed + project link
- [ ] Audio-only fallback (waveform video)

### Phase 6: Social Features
- [ ] Feed of followed users' projects
- [ ] Project playback view
- [ ] Remix flow (clone stems, create child project)
- [ ] Attribution chain display

### Phase 7: Web Player
- [ ] Public URL for each project (klip.app/p/...)
- [ ] Embeddable player
- [ ] "Remix in Klip" CTA
- [ ] Open Graph tags for rich link previews

### Phase 8: Polish
- [ ] Mobile touch optimization
- [ ] Loading states and error handling
- [ ] PWA support (add to home screen)
- [ ] Deep links from Bluesky posts

## Decisions Made

1. **Separate blob per stem** - More flexible, enables stem reuse, future-proofs for collaboration
2. **Future-proof lexicon** - Simple UI, rich data model that supports clips, effects, automation later
3. **Bluesky posting built-in** - Critical for testing loop and organic growth

## Open Questions for MVP

1. **Video: required or optional?**
   - Could start audio-only, add video in v1.1
   - But "video editor" is in the pitch...
   - Compromise: support both, but optimize for audio-first workflow

2. **Feed: build custom or use Bluesky's?**
   - Could create custom feed generator for klip projects
   - Or just query follows' projects directly
   - Start with direct queries, add feed generator later

3. **Project visibility: public only?**
   - AT Protocol doesn't have great private data support
   - MVP: everything is public
   - "Drafts" are just local (IndexedDB) until published

4. **Web player for shared links?**
   - Need a web view for when people click Klip links from Bluesky
   - Simple player + "Remix in Klip" CTA
   - Could be same app or separate lightweight page
