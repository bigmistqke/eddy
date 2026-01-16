# Architecture Documentation

Analyze the codebase architecture and update ARCHITECTURE.md with properly aligned ASCII diagrams.

## Process

1. **Explore the codebase** to understand:
   - Package structure and dependencies
   - Core abstractions (factories, interfaces, types)
   - Data flow (playback, frame transfer, audio transfer)
   - Worker architecture and communication patterns
   - Key design decisions

2. **Write a source document** at `docs/architecture-source.md` using diagon DSL blocks for diagrams:

   ````markdown
   # Eddy Architecture

   Description here...

   ## System Overview

   ```diagon:graphDAG
   MainThread -> Player
   Player -> VideoWorker
   Player -> AudioWorker
   VideoWorker -> Compositor
   AudioWorker -> RingBuffer
   ```

   ## Package Structure

   ```diagon:tree
   packages
     app
       components
       hooks
     audio
     video
   ```
   ````

3. **Render the diagrams** by running:
   ```bash
   node scripts/render-architecture.ts docs/architecture-source.md ARCHITECTURE.md
   ```

4. **Verify** the output with:
   ```bash
   ascii-guard lint ARCHITECTURE.md
   ```

## Diagon Block Types

Use these fenced code block languages:

| Block | Purpose | Example |
|-------|---------|---------|
| `diagon:graphDAG` | Directed graphs with boxes and arrows | `A -> B -> C` |
| `diagon:tree` | Hierarchical trees | Indented list |
| `diagon:sequence` | Sequence diagrams | `A -> B: message` |
| `diagon:table` | Tables from CSV | CSV data |
| `diagon:math` | Math expressions | `f(x) = x^2` |
| `diagon:frame` | Boxed text with line numbers | Plain text |

## GraphDAG Syntax

```
NodeA -> NodeB
NodeA -> NodeC
NodeB -> NodeD
NodeC -> NodeD
```

Produces boxes connected by arrows. Nodes with same name are merged.

## Tree Syntax

```
root
  child1
    grandchild1
    grandchild2
  child2
```

Uses indentation (2 spaces) to define hierarchy.

## Tips

- Keep node names short for cleaner diagrams
- Use descriptive names that match code (e.g., `VideoWorker`, `RingBuffer`)
- For complex flows, break into multiple smaller diagrams
- Add prose between diagrams to explain concepts
- The rendered output uses Unicode box-drawing characters

## Files

- **Source**: `docs/architecture-source.md` (editable, with diagon blocks)
- **Output**: `ARCHITECTURE.md` (generated, with rendered ASCII)
- **Script**: `scripts/render-architecture.ts`
