# Layout Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated Layout Builder view with two interaction modes (Append/Split), breadcrumb navigation, and a notched bottom bar.

**Architecture:** The existing `app.tsx` gains `view` and `mode` signal state. A new `layout-builder.tsx` houses the `LayoutBuilder` view (breadcrumb + canvas + bottom bar). `frame.tsx` gains a `handleDirections` prop so handles are shown only where the active mode dictates.

**Tech Stack:** SolidJS v2 beta (`solid-js@2.0.0-beta.9`, `@solidjs/signals@2.0.0-beta.9`), Vite, TypeScript, CSS Modules.

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/types.ts` | Add `Mode` and `View` type aliases |
| Modify | `src/app.tsx` | view/mode state, extended Context, append/split handlers, recording view `+` button |
| Modify | `src/frame.tsx` | Replace `active` handle logic with `handleDirections` prop |
| Create | `src/layout-builder.tsx` | `LayoutBuilder` view component, `Breadcrumb` component |
| Create | `src/layout-builder.module.css` | Styles for breadcrumb, mode toggle, bottom bar |

---

## Task 1: Add Mode and View types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add type aliases**

Replace the full contents of `src/types.ts` with:

```ts
export type Container = {
  type: "container"
  direction: "horizontal" | "vertical"
  children: Array<Entity | Container>
}
export type Entity = { type: "entity"; color: string }
export type Node = Container | Entity

export type Mode = "append" | "split"
export type View = "recording" | "layout-builder"
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: add Mode and View type aliases"
```

---

## Task 2: Add pathEquals and cloneNode helpers to app.tsx

**Files:**
- Modify: `src/app.tsx`

These helpers are used by the mutation functions added in Tasks 4 and 5.

- [ ] **Step 1: Add helpers after the existing `resolveNode` function**

Insert after `function resolveNode(...)` in `src/app.tsx`:

```ts
function pathEquals(a: number[], b: number[]) {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function cloneNode(node: Node): Node {
  if (node.type === "entity") return { ...node }
  return { type: "container", direction: node.direction, children: node.children.map(cloneNode) }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/app.tsx
git commit -m "feat: add pathEquals and cloneNode helpers"
```

---

## Task 3: Extend Context with mode, layout, and view-navigation

**Files:**
- Modify: `src/app.tsx`

The Context needs to expose `layout` (so deep components can resolve nodes), `mode`/`setMode` (for mode-aware rendering and mutation), and the existing `selection`/`setSelection`.

- [ ] **Step 1: Import new types**

At the top of `src/app.tsx`, update the import from `./types` to:

```ts
import type { Container, Entity, Mode, Node } from "./types"
```

- [ ] **Step 2: Replace the Context type**

Replace:

```ts
const Context = createContext<{
  selection: Selection
  setSelection: StoreSetter<Selection>
}>()
```

with:

```ts
const Context = createContext<{
  layout: Container
  selection: Selection
  setSelection: StoreSetter<Selection>
  mode: () => Mode
  setMode: (mode: Mode) => void
}>()
```

- [ ] **Step 3: Add mode signal and update Context.Provider value in App**

Inside `App()`, after the `selection` store declaration, add:

```ts
const [mode, setMode] = createSignal<Mode>("append")
```

Add `createSignal` to the solid-js import list.

Update the `<Context value={...}>` element to:

```tsx
<Context value={{ layout, selection, setSelection, mode, setMode }}>
```

- [ ] **Step 4: Typecheck**

Run: `pnpm typecheck`
Expected: no errors (NodeComponent will error until it uses the new context — OK for now).

- [ ] **Step 5: Commit**

```bash
git add src/app.tsx
git commit -m "feat: extend Context with layout, mode, and setMode"
```

---

## Task 4: Fix depth cycling to include root

**Files:**
- Modify: `src/app.tsx`

Currently `(selection.depth + 1) % selection.path.length` never targets the root (depth = path.length). The spec says cycling continues to root then wraps back.

- [ ] **Step 1: Update the depth cycle in NodeComponent's onClick**

Find in `NodeComponent`:

```ts
depth: (selection.depth + 1) % selection.path.length,
```

Replace with:

```ts
depth: (selection.depth + 1) % (selection.path.length + 1),
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Run `pnpm dev`. With two frames nested (path length ≥ 1), tap the same frame repeatedly and confirm the breadcrumb cycles: leaf → parent → root → leaf.

- [ ] **Step 4: Commit**

```bash
git add src/app.tsx
git commit -m "fix: cycle depth through root before wrapping back to leaf"
```

---

## Task 5: Implement appendToContainer

**Files:**
- Modify: `src/app.tsx`

`appendToContainer(containerPath, insertAtStart)` inserts a new Entity as first or last child of the container at `containerPath`, then selects it.

- [ ] **Step 1: Add the function inside App(), before the return**

```ts
function appendToContainer(containerPath: number[], insertAtStart: boolean) {
  const newEntity = createEntity()
  setLayout(proxy => {
    const container = resolveNode(proxy, containerPath) as Container
    if (insertAtStart) {
      container.children.unshift(newEntity)
    } else {
      container.children.push(newEntity)
    }
  })
  if (insertAtStart) {
    setSelection(() => ({ path: [...containerPath, 0], depth: 0 }))
  } else {
    const len = (resolveNode(layout, containerPath) as Container).children.length
    setSelection(() => ({ path: [...containerPath, len - 1], depth: 0 }))
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 6: Implement splitNode

**Files:**
- Modify: `src/app.tsx`

`splitNode(nodePath, direction)` wraps the node at `nodePath` in a new Container with a new Entity sibling, then selects the new Entity.

- [ ] **Step 1: Add the function inside App(), after `appendToContainer`**

```ts
function splitNode(nodePath: number[], direction: "top" | "bottom" | "left" | "right") {
  if (nodePath.length === 0) return // cannot split root
  const node = resolveNode(layout, nodePath)
  const newEntity = createEntity()
  const newContainer: Container = {
    type: "container",
    direction: direction === "left" || direction === "right" ? "horizontal" : "vertical",
    children:
      direction === "top" || direction === "left"
        ? [newEntity, cloneNode(node)]
        : [cloneNode(node), newEntity],
  }
  const parentPath = nodePath.slice(0, -1)
  const nodeIndex = nodePath[nodePath.length - 1]
  setLayout(proxy => {
    const parent = resolveNode(proxy, parentPath) as Container
    parent.children.splice(nodeIndex, 1, newContainer)
  })
  const newEntityIndex = direction === "top" || direction === "left" ? 0 : 1
  setSelection(() => ({ path: [...nodePath, newEntityIndex], depth: 0 }))
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit tasks 5 and 6**

```bash
git add src/app.tsx
git commit -m "feat: add appendToContainer and splitNode mutation functions"
```

---

## Task 7: Replace onAddFrame handler with mode dispatch

**Files:**
- Modify: `src/app.tsx`

The existing `onAddFrame` handler is replaced with a simple mode dispatch. The logic for *which path* to target is now encapsulated in `NodeComponent` (Task 8) via `handleDirections`.

- [ ] **Step 1: Replace the onAddFrame prop of NodeComponent in App's render**

Find (the large `onAddFrame={(path, direction) => { ... }}` block on `<NodeComponent>` in App's return) and replace the entire prop with:

```tsx
onAddFrame={(path, direction) => {
  if (mode() === "append") {
    appendToContainer(path, direction === "top" || direction === "left")
  } else {
    splitNode(path, direction)
  }
}}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 8: Update Frame to use handleDirections

**Files:**
- Modify: `src/frame.tsx`

`Frame` replaces the `active` boolean guard around all 4 handles with a `handleDirections` string array that controls which individual handles are shown. The `active` prop remains for the visual selection highlight.

- [ ] **Step 1: Update Frame props and render**

Replace the `Frame` export in `src/frame.tsx` with:

```tsx
export function Frame(
  props: ParentProps<{
    onClick?: JSX.EventHandlersElement<HTMLDivElement>["onClick"]
    active?: boolean
    handleDirections?: ("top" | "bottom" | "left" | "right")[]
    style?: JSX.CSSProperties
    class?: string
    onAddFrame(direction: "top" | "bottom" | "left" | "right"): void
  }>,
) {
  const dirs = () => props.handleDirections ?? []
  return (
    <div onClick={props.onClick} style={props.style} class={[props.class, styles.frame]}>
      <Show when={dirs().includes("top")}>
        <ArrowNotch
          onClick={event => {
            event.stopPropagation()
            props.onAddFrame("top")
          }}
          class={[styles.top]}
        />
      </Show>
      <Show when={dirs().includes("bottom")}>
        <ArrowNotch
          onClick={event => {
            event.stopPropagation()
            props.onAddFrame("bottom")
          }}
          class={[styles.bottom]}
        />
      </Show>
      <Show when={dirs().includes("left")}>
        <ArrowNotch
          onClick={event => {
            event.stopPropagation()
            props.onAddFrame("left")
          }}
          class={[styles.left]}
        />
      </Show>
      <Show when={dirs().includes("right")}>
        <ArrowNotch
          onClick={event => {
            event.stopPropagation()
            props.onAddFrame("right")
          }}
          class={[styles.right]}
        />
      </Show>
      {props.children}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: TypeScript will warn that callers of Frame still pass `active` without `handleDirections`. That's fine — we fix the caller in Task 9.

---

## Task 9: Update NodeComponent to compute handleDirections

**Files:**
- Modify: `src/app.tsx`

`NodeComponent` computes which handle directions to show for each node based on the current mode and selection, then passes them to Frame.

- [ ] **Step 1: Add createMemo to the solid-js import**

Add `createMemo` to the existing solid-js import list in `src/app.tsx`.

- [ ] **Step 2: Replace NodeComponent**

Replace the full `NodeComponent` function with:

```tsx
function NodeComponent(props: {
  layout: Node
  onAddFrame(path: number[], direction: "top" | "bottom" | "left" | "right"): void
  path: Array<number>
}) {
  const context = useContext(Context)!
  const isActive = () => isNodeActive(props.path, context.selection)

  // Which direction handles to show on THIS node
  const handleDirections = createMemo(() => {
    const s = context.selection
    const m = context.mode()

    // The node currently targeted by selection
    const targetedPath = s.path.slice(0, s.path.length - s.depth)

    let handlePath: number[]
    if (m === "split") {
      // Split operates on the targeted node itself
      handlePath = targetedPath
    } else {
      // Append operates on the targeted container:
      // if targeted is a container → itself; if leaf → its parent
      try {
        const targeted = resolveNode(context.layout, targetedPath)
        handlePath =
          targeted.type === "container" ? targetedPath : targetedPath.slice(0, -1)
      } catch {
        return []
      }
    }

    if (!pathEquals(props.path, handlePath)) return []

    if (m === "split") return ["top", "bottom", "left", "right"] as const

    // Append: only the container's axis
    const container = resolveNode(context.layout, handlePath) as Container
    return container.direction === "horizontal"
      ? (["left", "right"] as const)
      : (["top", "bottom"] as const)
  })

  return (
    <Switch>
      <Match when={props.layout?.type === "container" && props.layout}>
        {layout => (
          <Frame
            active={isActive()}
            handleDirections={handleDirections()}
            style={{ "flex-direction": layout().direction === "horizontal" ? "row" : "column" }}
            onAddFrame={direction => props.onAddFrame(props.path, direction)}
            class={styles.container}
          >
            <For each={layout().children}>
              {(child, index) => (
                <NodeComponent
                  layout={child()}
                  path={[...props.path, index()]}
                  onAddFrame={props.onAddFrame}
                />
              )}
            </For>
          </Frame>
        )}
      </Match>
      <Match when={props.layout?.type === "entity" && props.layout}>
        {entity => (
          <EntityFrame
            entity={entity()}
            active={isActive()}
            handleDirections={handleDirections()}
            onAddFrame={direction => props.onAddFrame(props.path, direction)}
            onClick={() => {
              if (isNodeActive(props.path, { ...context.selection, depth: 0 })) {
                context.setSelection(selection => ({
                  ...selection,
                  depth: (selection.depth + 1) % (selection.path.length + 1),
                }))
              } else {
                context.setSelection(() => ({ path: props.path, depth: 0 }))
              }
            }}
          />
        )}
      </Match>
    </Switch>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Manual verification — Append mode**

Run `pnpm dev`. Start with a single frame, select it. Confirm:
- In append mode (default), only 2 handles appear matching the parent container's axis.
- Tapping a handle inserts a sibling and selects it.

- [ ] **Step 5: Manual verification — Split mode (via mode signal)**

Temporarily add to App's render: `<button onClick={() => setMode(m => m === "append" ? "split" : "append")}>Toggle</button>`. Switch to split mode and confirm 4 handles appear. Tap a handle; a new container wrapping the frame should appear. Remove the debug button after verifying.

- [ ] **Step 6: Commit tasks 7–9**

```bash
git add src/app.tsx src/frame.tsx
git commit -m "feat: mode-aware handle rendering via handleDirections prop"
```

---

## Task 10: Create layout-builder.module.css

**Files:**
- Create: `src/layout-builder.module.css`

- [ ] **Step 1: Write the stylesheet**

```css
.layoutBuilder {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
}

.canvas {
  flex: 1;
  display: flex;
  position: relative;
}

.breadcrumb {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 4px;
}

.breadcrumb button {
  background: none;
  border: none;
  padding: 2px 6px;
  border-radius: 4px;
  color: #9ca3af;
  font-size: 13px;
  cursor: pointer;
  line-height: 1.4;
}

.breadcrumb button:hover {
  color: #e5e7eb;
}

.breadcrumb button.active {
  background: #1e3a5f;
  color: #60a5fa;
  border: 1px solid #2563eb;
}

.breadcrumb .separator {
  color: #4b5563;
  font-size: 13px;
  user-select: none;
}

.bottomBar {
  background: #111;
  border-top: 1px solid #222;
  border-radius: 14px 14px 0 0;
  padding: 10px 16px 20px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.bottomBar::before {
  content: "";
  position: absolute;
  top: -3px;
  left: 50%;
  transform: translateX(-50%);
  width: 32px;
  height: 4px;
  background: #333;
  border-radius: 2px;
}

.modeToggle {
  flex: 1;
  display: flex;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #374151;
}

.modeToggle button {
  flex: 1;
  background: #1f2937;
  border: none;
  color: #4b5563;
  font-size: 13px;
  font-weight: 600;
  padding: 8px;
  cursor: pointer;
}

.modeToggle button.active {
  background: #14532d;
  color: #86efac;
}

.doneButton {
  background: #1d4ed8;
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  color: white;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}

.doneButton:hover {
  background: #2563eb;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors (CSS modules need no code changes).

---

## Task 11: Create Breadcrumb component

**Files:**
- Create: `src/layout-builder.tsx` (initial)

- [ ] **Step 1: Create the file with Breadcrumb**

```tsx
import { createMemo, For, Show, useContext } from "solid-js"
import { Context } from "./app"
import styles from "./layout-builder.module.css"
import type { Container, Node } from "./types"

function resolveNode(root: Node, path: number[]): Node {
  let current = root
  for (let i = 0; i < path.length; i++) {
    if (current.type !== "container") throw new Error("not a container")
    current = current.children[path[i]]
  }
  return current
}

export function Breadcrumb() {
  const context = useContext(Context)!

  const segments = createMemo(() => {
    const { path } = context.selection
    const segs: Array<{ label: string; depth: number }> = []

    // Root segment: depth = path.length (one above leaf)
    segs.push({ label: "root", depth: path.length })

    let current: Node = context.layout
    for (let i = 0; i < path.length; i++) {
      if (current.type !== "container") break
      current = current.children[path[i]]
      const depth = path.length - 1 - i
      if (current.type === "container") {
        segs.push({
          label: current.direction === "vertical" ? "col" : "row",
          depth,
        })
      } else {
        segs.push({
          label: String.fromCharCode(65 + path[i]),
          depth: 0,
        })
      }
    }

    return segs
  })

  return (
    <div class={styles.breadcrumb}>
      <For each={segments()}>
        {(seg, i) => (
          <>
            <Show when={i() > 0}>
              <span class={styles.separator}>›</span>
            </Show>
            <button
              class={seg.depth === context.selection.depth ? styles.active : ""}
              onClick={() => context.setSelection(s => ({ ...s, depth: seg.depth }))}
            >
              {seg.label}
            </button>
          </>
        )}
      </For>
    </div>
  )
}
```

> **Note:** `resolveNode` is duplicated here from `app.tsx` to keep `layout-builder.tsx` self-contained. The one in `app.tsx` accepts `Container` as root; this one accepts `Node` to match the context type. If they drift, consolidate in a shared `src/utils.ts`.

- [ ] **Step 2: Export Context from app.tsx**

In `src/app.tsx`, change `const Context = createContext<...>()` to `export const Context = createContext<...>()`.

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

---

## Task 12: Create LayoutBuilder view

**Files:**
- Modify: `src/layout-builder.tsx`

- [ ] **Step 1: Add LayoutBuilder component to the file**

Append to `src/layout-builder.tsx`:

```tsx
import type { ComponentProps } from "solid-js"

export function LayoutBuilder(props: {
  children: ComponentProps<"div">["children"]
  onDone(): void
}) {
  const context = useContext(Context)!

  return (
    <div class={styles.layoutBuilder}>
      <div class={styles.canvas}>
        <Breadcrumb />
        {props.children}
      </div>
      <div class={styles.bottomBar}>
        <div class={styles.modeToggle}>
          <button
            class={context.mode() === "append" ? styles.active : ""}
            onClick={() => context.setMode("append")}
          >
            ⊞ Append
          </button>
          <button
            class={context.mode() === "split" ? styles.active : ""}
            onClick={() => context.setMode("split")}
          >
            ÷ Split
          </button>
        </div>
        <button class={styles.doneButton} onClick={props.onDone}>
          Done
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Commit tasks 10–12**

```bash
git add src/layout-builder.tsx src/layout-builder.module.css src/app.tsx
git commit -m "feat: add LayoutBuilder view with Breadcrumb and mode toggle"
```

---

## Task 13: Add recording view with + button and wire views in App

**Files:**
- Modify: `src/app.tsx`

- [ ] **Step 1: Add view signal to App**

Inside `App()`, after the `mode` signal, add:

```ts
const [view, setView] = createSignal<View>("recording")
```

Import `View` from `./types`.

- [ ] **Step 2: Add recording view styles to app.module.css**

Append to `src/app.module.css`:

```css
.recordingView {
  display: flex;
  flex: 1;
  position: relative;
}

.addButton {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background: #1d4ed8;
  border: none;
  border-radius: 50%;
  width: 48px;
  height: 48px;
  color: white;
  font-size: 24px;
  cursor: pointer;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

- [ ] **Step 3: Import LayoutBuilder and update App's return**

Add import at the top of `src/app.tsx`:

```ts
import { LayoutBuilder } from "./layout-builder"
```

Replace the existing `return (...)` in `App` with:

```tsx
return (
  <Context value={{ layout, selection, setSelection, mode, setMode }}>
    <div style={{ display: "flex", width: "100vw", height: "100%" }}>
      <Show when={view() === "recording"}>
        <div class={styles.recordingView}>
          <NodeComponent
            layout={layout}
            path={[]}
            onAddFrame={(path, direction) => {
              if (mode() === "append") {
                appendToContainer(path, direction === "top" || direction === "left")
              } else {
                splitNode(path, direction)
              }
            }}
          />
          <button class={styles.addButton} onClick={() => setView("layout-builder")}>
            +
          </button>
        </div>
      </Show>
      <Show when={view() === "layout-builder"}>
        <LayoutBuilder onDone={() => setView("recording")}>
          <NodeComponent
            layout={layout}
            path={[]}
            onAddFrame={(path, direction) => {
              if (mode() === "append") {
                appendToContainer(path, direction === "top" || direction === "left")
              } else {
                splitNode(path, direction)
              }
            }}
          />
        </LayoutBuilder>
      </Show>
    </div>
  </Context>
)
```

- [ ] **Step 4: Remove the duplicate onAddFrame block**

If the `onAddFrame` callback that was previously on `NodeComponent` is still present elsewhere in the return, remove it. The new return block above is the complete replacement.

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 6: End-to-end manual test**

Run `pnpm dev`. Verify:

1. Recording view shows the layout canvas with a `+` button.
2. Tapping `+` opens the Layout Builder view (breadcrumb top-left, mode toggle + Done in bottom bar).
3. In Append mode, selecting a frame shows 2 handles on the parent container's axis. Tapping a handle inserts a sibling and selects it. Breadcrumb updates.
4. In Split mode, selecting a frame shows 4 handles. Tapping a handle wraps it in a new container. Breadcrumb updates.
5. Cycling taps on the same frame cycles selection: leaf → parent → ... → root → leaf. Breadcrumb highlights the active segment.
6. Tapping a breadcrumb segment jumps directly to that depth.
7. Tapping Done returns to the recording view.

- [ ] **Step 7: Commit**

```bash
git add src/app.tsx src/app.module.css
git commit -m "feat: wire recording view + button and layout builder view navigation"
```

---

## Self-Review Against Spec

| Spec requirement | Covered by task |
|---|---|
| Dedicated layout builder view, opened from `+` | Task 13 |
| No record/play controls in layout builder | Task 13 (only canvas + bottom bar) |
| Selection: path array + depth | Unchanged from existing code |
| Click-to-cycle-depth through root | Task 4 (fix modulus) |
| Breadcrumb top-left, derives from selection | Tasks 10, 11 |
| Breadcrumb segments tappable to jump depth | Task 11 |
| Append mode: 2 handles on parent container's axis | Task 8, 9 |
| Split mode: 4 handles on targeted node | Task 8, 9 |
| Append inserts sibling, selects new frame | Task 5 |
| Split wraps node in new container, selects new frame | Task 6 |
| Mode toggle in bottom bar | Task 12 |
| Done button returns to recording view | Task 13 |
| Data model unchanged | No changes to `types.ts` shape |
| New frame selected after insert/split | Tasks 5, 6 |
