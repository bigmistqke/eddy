# @klip/app

SolidJS web application for Klip - a mobile-first video editor with DAW capabilities.

## Development

```bash
pnpm dev      # Start dev server
pnpm build    # Production build
pnpm preview  # Preview production build
```

## Structure

```
src/
├── components/
│   └── editor/          # Editor UI (Track, Editor components)
├── lib/
│   ├── atproto/         # AT Protocol auth and record management
│   ├── player/          # usePlayback hook (SolidJS wrapper)
│   ├── player-compositor/ # Playback ↔ Compositor integration
│   ├── project-store/   # Project state management
│   └── recorder/        # MediaRecorder wrapper
└── routes/              # File-based routing
```

## Dependencies

- `@klip/codecs` - Demuxing
- `@klip/playback` - Synchronized playback
- `@klip/compositor` - Video compositing
- `@klip/mixer` - Audio mixing
- `@klip/lexicons` - AT Protocol schemas
- `solid-js` - UI framework
- `@solidjs/router` - Routing
- `@atproto/api` - AT Protocol client
