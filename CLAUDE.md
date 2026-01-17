# CLAUDE.md

# Project Instructions

## Decision Graph Workflow

**THIS IS MANDATORY. Log decisions IN REAL-TIME, not retroactively.**

### The Core Rule

```
BEFORE you do something -> Log what you're ABOUT to do
AFTER it succeeds/fails -> Log the outcome
CONNECT immediately -> Link every node to its parent
AUDIT regularly -> Check for missing connections
```

### Behavioral Triggers - MUST LOG WHEN:

| Trigger                      | Log Type           | Example                        |
| ---------------------------- | ------------------ | ------------------------------ |
| User asks for a new feature  | `goal` **with -p** | "Add dark mode"                |
| Choosing between approaches  | `decision`         | "Choose state management"      |
| About to write/edit code     | `action`           | "Implementing Redux store"     |
| Something worked or failed   | `outcome`          | "Redux integration successful" |
| Notice something interesting | `observation`      | "Existing code uses hooks"     |

### CRITICAL: Capture VERBATIM User Prompts

**Prompts must be the EXACT user message, not a summary.** When a user request triggers new work, capture their full message word-for-word.

**BAD - summaries are useless for context recovery:**

```bash
# DON'T DO THIS - this is a summary, not a prompt
deciduous add goal "Add auth" -p "User asked: add login to the app"
```

**GOOD - verbatim prompts enable full context recovery:**

```bash
# Use --prompt-stdin for multi-line prompts
deciduous add goal "Add auth" -c 90 --prompt-stdin << 'EOF'
I need to add user authentication to the app. Users should be able to sign up
with email/password, and we need OAuth support for Google and GitHub. The auth
should use JWT tokens with refresh token rotation.
EOF

# Or use the prompt command to update existing nodes
deciduous prompt 42 << 'EOF'
The full verbatim user message goes here...
EOF
```

**When to capture prompts:**

- Root `goal` nodes: YES - the FULL original request
- Major direction changes: YES - when user redirects the work
- Routine downstream nodes: NO - they inherit context via edges

**Updating prompts on existing nodes:**

```bash
deciduous prompt <node_id> "full verbatim prompt here"
cat prompt.txt | deciduous prompt <node_id>  # Multi-line from stdin
```

Prompts are viewable in the TUI detail panel (`deciduous tui`) and web viewer.

### CRITICAL: Maintain Connections

**The graph's value is in its CONNECTIONS, not just nodes.**

| When you create... | IMMEDIATELY link to...            |
| ------------------ | --------------------------------- |
| `outcome`          | The action/goal it resolves       |
| `action`           | The goal/decision that spawned it |
| `option`           | Its parent decision               |
| `observation`      | Related goal/action               |

**Root `goal` nodes are the ONLY valid orphans.**

### Quick Commands

```bash
deciduous add goal "Title" -c 90 -p "User's original request"
deciduous add action "Title" -c 85
deciduous link FROM TO -r "reason"  # DO THIS IMMEDIATELY!
deciduous serve   # View live (auto-refreshes every 30s)
deciduous sync    # Export for static hosting

# Metadata flags
# -c, --confidence 0-100   Confidence level
# -p, --prompt "..."       Store the user prompt (use when semantically meaningful)
# -f, --files "a.rs,b.rs"  Associate files
# -b, --branch <name>      Git branch (auto-detected)
# --commit <hash|HEAD>     Link to git commit (use HEAD for current commit)

# Branch filtering
deciduous nodes --branch main
deciduous nodes -b feature-auth
```

### CRITICAL: Link Commits to Actions/Outcomes

**After every git commit, link it to the decision graph!**

```bash
git commit -m "feat: add auth"
deciduous add action "Implemented auth" -c 90 --commit HEAD
deciduous link <goal_id> <action_id> -r "Implementation"
```

The `--commit HEAD` flag captures the commit hash and links it to the node. The web viewer will show commit messages, authors, and dates.

### Git History & Deployment

```bash
# Export graph AND git history for web viewer
deciduous sync

# This creates:
# - docs/graph-data.json (decision graph)
# - docs/git-history.json (commit info for linked nodes)
```

To deploy to GitHub Pages:

1. `deciduous sync` to export
2. Push to GitHub
3. Settings > Pages > Deploy from branch > /docs folder

Your graph will be live at `https://<user>.github.io/<repo>/`

### Branch-Based Grouping

Nodes are auto-tagged with the current git branch. Configure in `.deciduous/config.toml`:

```toml
[branch]
main_branches = ["main", "master"]
auto_detect = true
```

### Audit Checklist (Before Every Sync)

1. Does every **outcome** link back to what caused it?
2. Does every **action** link to why you did it?
3. Any **dangling outcomes** without parents?

### Session Start Checklist

```bash
deciduous nodes    # What decisions exist?
deciduous edges    # How are they connected? Any gaps?
git status         # Current state
```

### Multi-User Sync

Share decisions across teammates:

```bash
# Export your branch's decisions
deciduous diff export --branch feature-x -o .deciduous/patches/my-feature.json

# Apply patches from teammates (idempotent)
deciduous diff apply .deciduous/patches/*.json

# Preview before applying
deciduous diff apply --dry-run .deciduous/patches/teammate.json
```

PR workflow: Export patch -> commit patch file -> PR -> teammates apply.

# Project Preferences

## Coding Style

### SolidJS Signals

Assign signal values to local const with underscore prefix:

```ts
// Good
const _player = player()
if (!_player) return
_player.play()

// Bad - calling signal multiple times
if (!player()) return
player().play()
```

### Naming

No single-character variables:

```ts
// Good
for (const playback of playbacks) { ... }

// Bad
for (const p of playbacks) { ... }
```

### CSS

Prefer `display: grid` over flexbox.

### Closures over Classes

Prefer factory functions returning object literals over classes:

```ts
// Good - createX factory with closure
function helperThatDoesntNeedState(frame: VideoFrame) { ... }

export function createPlayback(config: Config): Playback {
  // Private state
  let buffer: Frame[] = []

  // Private functions (need internal state)
  function seekInternal(time: number) {
    buffer = []
    // ...
  }

  // Public API
  return {
    play() { ... },
    seek(time: number) {
      seekInternal(time)
    },
  }
}

// Bad - class
export class PlaybackEngine {
  private buffer: Frame[] = []
  play() { ... }
}
```

Rules:

- Factory function named `createX`, returns interface `X`
- Private state/functions inside closure
- Pure helpers that don't need internal state go OUTSIDE the factory (top of file)
- Public API is the returned object literal

### File Structure

Order of sections in a file:

1. JSDoc explaining the file (with capitalized name of main export)
2. Imports
3. Constants
4. All types
5. Utils
6. Named private modules
7. Main export

Section titles use block comment format with spaced capitalized function name:

```ts
/**********************************************************************************/
/*                                                                                */
/*                             Create Playback Timing                             */
/*                                                                                */
/**********************************************************************************/

function createPlaybackTiming() { ... }
```

Note: Barrel files (index.ts re-exports) do NOT need JSDoc explanation at top.

## Decision Graph

Deciduous tracks goals, decisions, actions, outcomes, and observations in a persistent graph that survives context loss.

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
│   deciduous add goal "<title>" -c 90 --prompt-stdin << 'EOF'
│   <user's verbatim message>
│   EOF
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
│   pnpm sync-issues  # Posts to linked GitHub issues
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
│
SESSION END
│
└─► deciduous sync
```

### Autonomy Rules

| Node Type     | Ask First? | When                              |
| ------------- | ---------- | --------------------------------- |
| `goal`        | **YES**    | User request starts new work      |
| `decision`    | **YES**    | Multiple valid approaches         |
| `action`      | No         | Before each logical change        |
| `outcome`     | No         | After success/failure             |
| `observation` | No         | Every gotcha, learning, discovery |
