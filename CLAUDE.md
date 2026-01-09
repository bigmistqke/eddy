# CLAUDE.md

This file provides guidance to Claude Code when working with this repository.

## Project Overview

Eddy is a mobile-first video editor with musical DAW capabilities, built on AT Protocol for decentralized creative collaboration. The core concept treats every project as a **remixable stem collection** that others can fork and build upon.

## Monorepo Structure

```
packages/
├── app/          # SolidJS web application
├── codecs/       # Demuxer, muxer, audio/video decoders (mediabunny, WebCodecs)
├── compositor/   # WebGL video compositing (@bigmistqke/view.gl)
├── lexicons/     # AT Protocol lexicons (app.eddy.project, app.eddy.stem)
├── mixer/        # Web Audio API mixer (gain, pan, routing)
├── playback/     # Video playback (frame buffer, audio scheduler)
└── utils/        # Shared utilities (debug logging, perf monitoring)
```

## Tech Stack

- **SolidJS** - UI framework
- **@atproto/api** - OAuth login, blob upload, record CRUD
- **@bigmistqke/rpc** - Type-safe RPC for worker communication
- **@bigmistqke/view.gl** - WebGL video compositing
- **@bigmistqke/solid-whenever** - Reactive guards (`whenEffect`, `whenMemo`)
- **mediabunny** - WebM muxing (VP9 + Opus)
- **WebCodecs API** - Frame-level video/audio encode/decode

## Key Patterns

### Generator-based Actions

Use `action()` with generators for async operations with automatic cancellation:

```ts
import { action, defer, hold } from '~/hooks/action'

const recordAction = action(function* (trackIndex: number, { onCleanup }) {
  const stream = yield* defer(navigator.mediaDevices.getUserMedia({ video: true }))
  onCleanup(() => stream.getTracks().forEach(t => t.stop()))

  // Hold until cancelled, then return value
  return hold(() => ({ trackIndex, duration: performance.now() }))
})

// Usage
recordAction(0)           // Start
recordAction.cancel()     // Cancel and trigger cleanup
const result = await recordAction.promise()  // Get result after cancel
```

### Worker Communication

Use `@bigmistqke/rpc` for type-safe worker RPC:

```ts
import { rpc, transfer, expose } from '@bigmistqke/rpc/messenger'
import type { WorkerMethods } from './worker'

// Main thread
const worker = rpc<WorkerMethods>(new Worker('./worker.ts'))
await worker.init(transfer(offscreenCanvas))

// Worker
expose({ init(canvas) { ... } })
```

### Resource Primitives

Custom reactive resources with cleanup:

```ts
import { resource } from '~/hooks/resource'
import { deepResource } from '~/hooks/deep-resource'

// resource() - like createResource but with onCleanup
const [player] = resource(canvas, async (canvas, { onCleanup }) => {
  const p = await createPlayer(canvas)
  onCleanup(() => p.destroy())
  return p
})

// deepResource() - deep reactive updates to store
const [project, { mutate }] = deepResource(source, fetcher)
```

## SolidJS Conventions

### Signal Access

Always assign signal values to local const with underscore prefix:

```ts
// Good
const _player = player()
if (!_player) return
_player.play()

// Bad - calling signal multiple times
if (!player()) return
player().play()
```

### Reactive Guards

Use `@bigmistqke/solid-whenever` for null-safe reactive access:

```ts
import { whenEffect, whenMemo } from '@bigmistqke/solid-whenever'

whenEffect(player, player => player.play())

const hasClip = whenMemo(player, p => p.hasClip(0), () => false)
```

### Naming

No single-character variables. Use descriptive names:

```ts
// Good
for (const playback of playbacks) { ... }
const link = document.createElement('a')

// Bad
for (const p of playbacks) { ... }
const a = document.createElement('a')
```

## Architecture Notes

### Audio Routing During Recording

Chrome has a bug where `AudioContext.destination` interferes with `getUserMedia` capture, causing thin audio with phasing artifacts. During recording, audio is routed through `MediaStreamAudioDestinationNode` → `HTMLAudioElement` to bypass this:

```ts
mixer.useMediaStreamOutput()   // During recording
mixer.useDirectOutput()        // Normal playback
```

See: https://groups.google.com/a/chromium.org/g/chromium-discuss/c/6s2EnqdBERE

### Worker Architecture

Heavy operations run in workers:
- **compositor.worker** - WebGL rendering on OffscreenCanvas
- **demux.worker** - Video demuxing + decoding
- **muxer.worker** - VP9/Opus encoding to WebM
- **capture.worker** - Camera capture to raw frames

Workers communicate via `MessageChannel` ports for direct worker-to-worker RPC.

## MVP Constraints

Current implementation is a 4-track recorder (think Tascam Portastudio):

- 4 tracks max, 1 clip per track starting at t=0
- Layout: 2x2 grid only
- Audio effects: gain + pan only
- No video effects, transitions, or automation

## CSS Guidelines

Prefer `display: grid` over flexbox for layouts.

## Workflow

- **Tickets** - A ticket is a single task. After completing, ask user to confirm before proceeding
- **Before committing** - List things for user to test, wait for confirmation
- **Ask before committing** - Always ask permission before `git commit`
- **Commit messages** - No Claude signature
- **TypeScript checks** - Run `pnpm types` to check compilation. Only run once when creating new files, don't repeatedly check.

## Decision Graph Workflow

Deciduous tracks goals, decisions, actions, outcomes, and observations in a persistent graph that survives context loss.

### Slash Commands

| Command | Mode | Purpose |
|---------|------|---------|
| `/recover` | Session Start | Query graph, check git state, recover context |
| `/work <goal>` | Working | Start work transaction (creates goal, guides through flow) |
| `/commit [msg]` | Commit | Analyze coherence, split if needed, commit + sync deciduous |
| `/decision <action>` | Manual | Direct access to deciduous CLI for edge cases |

### Session Lifecycle

```
SESSION START
│
├─► /recover
│   Query past decisions, pending work, git state
│
USER REQUEST
│
├─► ASK before logging goal
│   "I'll log this as a goal: <title>. OK?"
│   Then: deciduous add goal "<title>" -c 90 --prompt-stdin << 'EOF'
│         <user's verbatim message>
│         EOF
│
WORKING (auto-log, don't ask)
│
├─► Log action BEFORE each logical change
│   deciduous add action "<what I'm about to do>" -c 85
│   deciduous link <goal_id> <action_id> -r "Implementation"
│
├─► Log observation for EVERY gotcha/learning
│   deciduous add observation "<what I discovered>" -c 80
│   deciduous link <related_node> <obs_id> -r "Discovery"
│
├─► Log outcome AFTER completion
│   deciduous add outcome "<result>" -c 90
│   deciduous link <action_id> <outcome_id> -r "Result"
│
BEFORE COMMIT
│
├─► List things for user to test
├─► Wait for confirmation
├─► /commit [msg]
│   - Analyzes diff coherence
│   - Splits if needed (asks first)
│   - Warns if overlapping work
│   - Commits WITHOUT Claude signature
│   - Creates outcome with --commit HEAD
│   - Links to action, syncs graph
│
SESSION END (or context getting long)
│
└─► Final sync: deciduous sync
```

### Logging Granularity

**Logical changes** - not every file edit, but every coherent unit of work:
- Adding a feature component = 1 action
- Fixing a bug = 1 action (+ 1 observation for the root cause)
- Refactoring 3 related files = 1 action
- Discovering a gotcha = 1 observation

### Autonomy Rules

| Node Type | Ask First? | When |
|-----------|------------|------|
| `goal` | **YES** | User request starts new work |
| `decision` | **YES** | Multiple valid approaches |
| `action` | No | Before each logical change |
| `outcome` | No | After success/failure |
| `observation` | No | Every gotcha, learning, discovery |

### Verbatim Prompts

Goals MUST capture the user's exact message:

```bash
deciduous add goal "Add dark mode" -c 90 --prompt-stdin << 'EOF'
Can you add dark mode support? I want a toggle in the settings
that persists to localStorage, and it should respect the system
preference by default.
EOF
```

### Connection Rules

| Node Type | Link To |
|-----------|---------|
| `goal` | Can be root (no parent needed) |
| `action` | Parent goal or decision |
| `outcome` | The action it resolves |
| `observation` | Related goal/action/decision |
| `option` | Parent decision |

### Quick Reference

```bash
# Session start
/recover

# Start work (asks first)
/work "Add feature X"

# Manual logging
deciduous add goal "Title" -c 90 -p "prompt"
deciduous add action "Title" -c 85 -f "file1.ts,file2.ts"
deciduous add observation "Title" -c 80
deciduous add outcome "Title" -c 90 --commit HEAD
deciduous link <from> <to> -r "reason"

# Always after commit
deciduous sync

# View
deciduous nodes
deciduous serve
```
