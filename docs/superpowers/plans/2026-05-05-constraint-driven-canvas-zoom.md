# Constraint-driven Canvas Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the canvas in layout mode automatically pan and zoom (via CSS transform) so the currently selected node always renders at a size where its UI fits, and unify all HUD chrome on the existing notch component.

**Architecture:** The viewport transform is *derived* from the existing `selection` state — there is no new viewport state to manage. A pure function computes the right `scale` + `translate` for the selected node and the result is applied as a CSS transform on the layout root, with a CSS transition for animation. Three HUD slots (bottom mode bar, top-left breadcrumb, top-right contextual toolbar) are rendered using the existing `Notch` component. Frame add-handles register HUD elements with the shared `ResizeObserver` plumbing already in place.

**Tech Stack:** Solid 2.x (`solid-js`, `@solidjs/signals`), TypeScript, Vite, CSS Modules. No test framework currently configured — verification is via `npx tsc --noEmit` plus `npm run dev` browser checks.

---

## File Structure

**New files:**
- `src/icons.tsx` — append `BackIcon` (the supplied SVG)
- `src/ui-constants.ts` — single source of truth for `MIN_NODE_WIDTH`, `MIN_NODE_HEIGHT`, `VIEWPORT_PADDING`
- `src/viewport.ts` — pure functions that compute selected-node path and viewport transform
- `src/contextual-toolbar.tsx` — top-right notch containing context-sensitive buttons (back button is the first occupant)
- `src/contextual-toolbar.module.css` — positioning styles for the right-edge vertical notch

**Modified files:**
- `src/types.ts` — extend `AppContext` with `breadcrumbEl` and `contextualToolbarEl` accessors + setters
- `src/app.tsx` — provide the new HUD element accessors in the context value
- `src/frame.tsx` — extend `Notch` with an `orientation` prop; extend `Frame` to accept a `data-path` HTML attribute; extend `checkOverlap` to compare against breadcrumb and contextual toolbar elements per direction
- `src/frame.module.css` — add `.hud-top`, `.hud-right`, `.hud-left`, `.hud-bottom` orientation rules for the Notch backdrop
- `src/node-component.tsx` — pass the current path as `data-path` to each rendered frame
- `src/layout-builder.tsx` — wrap `Breadcrumb` in a top-orientation `Notch`; render `ContextualToolbar`; apply the viewport transform to the canvas
- `src/layout-builder.module.css` — replace the existing `.breadcrumb` standalone style with positioning for the new top notch; add `.canvasInner` (the transformed layer) and viewport transition

---

## Task 1: Add BackIcon

**Files:**
- Modify: `src/icons.tsx`

- [ ] **Step 1: Append the BackIcon component**

Add at the end of `src/icons.tsx`:

```tsx
export function BackIcon(props: { class?: string }) {
  return (
    <svg
      class={props.class}
      width="41"
      height="23"
      viewBox="0 0 41 23"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M32.8281 22.4998L16.3281 22.4998C15.2236 22.4998 14.3281 21.6043 14.3281 20.4998C14.3281 19.3952 15.2236 18.4998 16.3281 18.4998L32.8281 18.4998C35.0373 18.4998 36.8281 16.7089 36.8281 14.4998C36.8281 12.2907 35.0373 10.4998 32.8281 10.4998L7.65625 10.4998L10.7422 13.5857C11.5232 14.3667 11.5232 15.6328 10.7422 16.4138C9.96114 17.1949 8.69511 17.1949 7.91406 16.4138L-6.11959e-07 8.49976L7.91406 0.585693C8.6951 -0.195309 9.96115 -0.195308 10.7422 0.585693C11.5232 1.36673 11.5232 2.63277 10.7422 3.41382L7.65625 6.49976L32.8281 6.49975C37.2464 6.49975 40.8281 10.0814 40.8281 14.4998C40.8281 18.918 37.2464 22.4998 32.8281 22.4998Z"
        fill="currentColor"
      />
    </svg>
  )
}
```

- [ ] **Step 2: Verify the project still type-checks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/icons.tsx
git commit -m "feat(icons): add BackIcon for contextual toolbar"
```

---

## Task 2: UI Constants Module

**Files:**
- Create: `src/ui-constants.ts`

- [ ] **Step 1: Write the constants file**

Create `src/ui-constants.ts`:

```ts
// Minimum rendered dimensions a frame's UI requires to be usable.
// Derived from the worst-case in-frame UI footprint (handles + edge buttons + interior).
// Tune empirically; the implementation should adjust if the visible UI changes.
export const MIN_NODE_WIDTH = 200
export const MIN_NODE_HEIGHT = 200

// Padding around the selected node when fitting it inside the canvas viewport.
export const VIEWPORT_PADDING = 24
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui-constants.ts
git commit -m "feat: define UI size constants for constraint-driven zoom"
```

---

## Task 3: Add `data-path` Attribute to Frame

This lets the viewport math locate any node's DOM element by its path key (e.g. `"0.1.2"`). Without it, the algorithm cannot look up the rendered selected node.

**Files:**
- Modify: `src/frame.tsx` (Frame component, add prop and pass to root div)

- [ ] **Step 1: Extend the Frame props type**

In `src/frame.tsx`, change the `Frame` component's props from:

```tsx
export function Frame(
  props: ParentProps<{
    onClick?: JSX.EventHandlersElement<HTMLDivElement>["onClick"]
    handleDirections?: ("top" | "bottom" | "left" | "right")[]
    buttonDirections?: ("top" | "bottom" | "left" | "right")[]
    style?: JSX.CSSProperties
    class?: string
    onAddFrame(direction: "top" | "bottom" | "left" | "right"): void
  }>,
) {
```

to:

```tsx
export function Frame(
  props: ParentProps<{
    onClick?: JSX.EventHandlersElement<HTMLDivElement>["onClick"]
    handleDirections?: ("top" | "bottom" | "left" | "right")[]
    buttonDirections?: ("top" | "bottom" | "left" | "right")[]
    style?: JSX.CSSProperties
    class?: string
    onAddFrame(direction: "top" | "bottom" | "left" | "right"): void
    "data-path"?: string
  }>,
) {
```

- [ ] **Step 2: Pass the attribute through to the root `<div>`**

In the same file, change the JSX root div from:

```tsx
<div
  ref={frameRef}
  onClick={props.onClick}
  style={props.style}
  class={[props.class, styles.frame]}
>
```

to:

```tsx
<div
  ref={frameRef}
  onClick={props.onClick}
  style={props.style}
  class={[props.class, styles.frame]}
  data-path={props["data-path"]}
>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (`EntityFrame` receives `data-path` via the spread of `rest` and forwards it automatically.)

- [ ] **Step 4: Commit**

```bash
git add src/frame.tsx
git commit -m "feat(frame): accept data-path attribute for path-based DOM queries"
```

---

## Task 4: Set `data-path` from NodeComponent

**Files:**
- Modify: `src/node-component.tsx`

- [ ] **Step 1: Add a `pathKey` memo and pass it on both Frame variants**

In `src/node-component.tsx`, inside `NodeComponent`, add a memo near the top (after `const context = ...`):

```tsx
const pathKey = createMemo(() => props.path.join("."))
```

(Already imports `createMemo`.)

- [ ] **Step 2: Pass `data-path` to the container Frame**

In the container `<Match>` block, find the existing `<Frame ...>` and add `data-path={pathKey()}` alongside its other props:

```tsx
<Frame
  handleDirections={handles().directions}
  buttonDirections={handles().buttons}
  style={{ "flex-direction": layout().direction === "horizontal" ? "row" : "column" }}
  onAddFrame={direction =>
    layoutView()?.mode === "append"
      ? props.onAppend(props.path, direction)
      : props.onSplit(props.path, direction)
  }
  class={[
    styles.container,
    inLayoutView()
      ? props.path.length === 0
        ? styles.layoutContainerRoot
        : styles.layoutContainer
      : "",
  ].join(" ")}
  data-path={pathKey()}
>
```

- [ ] **Step 3: Pass `data-path` to the entity Frame**

In the entity `<Match>` block, find the `<EntityFrame ...>` and add `data-path={pathKey()}` alongside its other props:

```tsx
<EntityFrame
  entity={entity()}
  handleDirections={handles().directions}
  buttonDirections={handles().buttons}
  class={inLayoutView() ? styles.layoutEntity : undefined}
  onAddFrame={direction =>
    layoutView()?.mode === "append"
      ? props.onAppend(props.path, direction)
      : props.onSplit(props.path, direction)
  }
  data-path={pathKey()}
  onClick={...existing onClick handler unchanged...}
/>
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manually verify in the browser**

Run: `npm run dev` (in another terminal if not already running). Open the app, switch to layout mode, open dev tools, and confirm each rendered frame `<div>` has a `data-path` attribute matching its position in the tree (root = `""`, first child = `"0"`, etc.). Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add src/node-component.tsx
git commit -m "feat(node-component): emit data-path on every frame"
```

---

## Task 5: Viewport Math Module

A pure module that, given the selection state and the relevant DOM elements, returns the CSS transform string. No reactivity, no rendering — easily reasoned about and reusable.

**Files:**
- Create: `src/viewport.ts`

- [ ] **Step 1: Write the module**

Create `src/viewport.ts`:

```ts
import type { Selection } from "./types"
import { MIN_NODE_HEIGHT, MIN_NODE_WIDTH, VIEWPORT_PADDING } from "./ui-constants"

export type ViewportTransform = { scale: number; x: number; y: number }

export const IDENTITY_VIEWPORT: ViewportTransform = { scale: 1, x: 0, y: 0 }

/** Path key for the selected node — entity path minus `depth` levels. */
export function selectedPathKey(selection: Selection): string {
  const len = selection.path.length - selection.depth
  if (len <= 0) return ""
  return selection.path.slice(0, len).join(".")
}

/** Cumulative un-transformed offset of `el` relative to `root`. Walks the offsetParent chain. */
function offsetRelativeToRoot(el: HTMLElement, root: HTMLElement) {
  let x = 0
  let y = 0
  let cur: HTMLElement | null = el
  while (cur && cur !== root) {
    x += cur.offsetLeft
    y += cur.offsetTop
    cur = cur.offsetParent as HTMLElement | null
  }
  return { x, y, width: el.offsetWidth, height: el.offsetHeight }
}

/**
 * Compute the constraint-correct viewport transform for a selected DOM element.
 *
 * - `scale` is the larger of:
 *   - the minimum that satisfies the UI-fit constraint (MIN_NODE_W/H), and
 *   - the scale that fits the node within the canvas with VIEWPORT_PADDING on all sides.
 *
 * - `x`, `y` translate the layout root so the selected node's center lands at the canvas center.
 *
 * Caller must pass un-transformed measurements: `node` should be queried *while* the layout root
 * is at the previous transform — `offsetWidth/Height` and `offsetLeft/Top` ignore CSS transforms,
 * so this is safe.
 */
export function computeViewportTransform(
  node: HTMLElement,
  layoutRoot: HTMLElement,
  canvasW: number,
  canvasH: number,
): ViewportTransform {
  const { x: nx, y: ny, width: nw, height: nh } = offsetRelativeToRoot(node, layoutRoot)
  if (nw === 0 || nh === 0) return IDENTITY_VIEWPORT

  const scaleMin = Math.max(MIN_NODE_WIDTH / nw, MIN_NODE_HEIGHT / nh)
  const scaleFit = Math.min(
    (canvasW - 2 * VIEWPORT_PADDING) / nw,
    (canvasH - 2 * VIEWPORT_PADDING) / nh,
  )
  const scale = Math.max(scaleMin, scaleFit)

  const nodeCenterX = nx + nw / 2
  const nodeCenterY = ny + nh / 2
  const x = canvasW / 2 - nodeCenterX * scale
  const y = canvasH / 2 - nodeCenterY * scale

  return { scale, x, y }
}

export function transformToCss(t: ViewportTransform) {
  return `translate(${t.x}px, ${t.y}px) scale(${t.scale})`
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/viewport.ts
git commit -m "feat: viewport math for constraint-driven canvas zoom"
```

---

## Task 6: Apply Viewport Transform to LayoutBuilder Canvas

This is the first user-visible change: in layout mode, selecting a small frame zooms in.

**Files:**
- Modify: `src/layout-builder.tsx`
- Modify: `src/layout-builder.module.css`

- [ ] **Step 1: Update `layout-builder.module.css` to introduce a transformed inner layer**

Replace the file contents with:

```css
.layoutBuilder {
  position: relative;
  width: 100%;
  height: 100%;
}

.canvas {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

.canvasInner {
  position: absolute;
  inset: 0;
  display: flex;
  transform-origin: 0 0;
  will-change: transform;
}

/* legacy plain-text breadcrumb styles will be replaced in a later task — */
/* keep them here for now so the breadcrumb still renders */
.breadcrumb {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: var(--z-hud);
  display: flex;
  align-items: center;
  gap: 6px;
  background: black;
  border-radius: 8px;
  padding: 6px 10px;
}

.breadcrumb button {
  background: none;
  border: none;
  padding: 0;
  color: var(--color-front);
  font-size: 13px;
  cursor: pointer;
}

.breadcrumb button.active {
  color: var(--color-selection);
  text-decoration: underline;
}

.breadcrumb .separator {
  color: var(--color-front);
  font-size: 13px;
  user-select: none;
}
```

- [ ] **Step 2: Wrap the layout content in a transformed inner div in `LayoutBuilder`**

In `src/layout-builder.tsx`, replace the `LayoutBuilder` component with:

```tsx
import { ComponentProps, createEffect, createMemo, createSignal, For, Show, useContext } from "solid-js"
import { Context } from "./context"
import styles from "./layout-builder.module.css"
import type { Node } from "./types"
import {
  computeViewportTransform,
  IDENTITY_VIEWPORT,
  selectedPathKey,
  transformToCss,
  type ViewportTransform,
} from "./viewport"

// ... existing Breadcrumb component unchanged ...

export function LayoutBuilder(props: { children: ComponentProps<"div">["children"] }) {
  const context = useContext(Context)!
  let canvasEl!: HTMLDivElement
  let innerEl!: HTMLDivElement
  const [transform, setTransform] = createSignal<ViewportTransform>(IDENTITY_VIEWPORT)

  // Recompute viewport whenever selection changes. `selectedPathKey` reads
  // `selection.path` and `selection.depth`, which subscribes the effect.
  createEffect(() => {
    const key = selectedPathKey(context.selection)
    if (!innerEl || !canvasEl) return

    if (key === "") {
      setTransform(IDENTITY_VIEWPORT)
      return
    }

    const node = innerEl.querySelector<HTMLElement>(`[data-path="${key}"]`)
    if (!node) {
      setTransform(IDENTITY_VIEWPORT)
      return
    }

    const rect = canvasEl.getBoundingClientRect()
    setTransform(computeViewportTransform(node, innerEl, rect.width, rect.height))
  })

  return (
    <div class={styles.layoutBuilder}>
      <div class={styles.canvas} ref={canvasEl}>
        <div
          class={styles.canvasInner}
          ref={innerEl}
          style={{ transform: transformToCss(transform()) }}
        >
          {props.children}
        </div>
        <Breadcrumb />
      </div>
    </div>
  )
}
```

(Keep the `Breadcrumb` component and the `Node` import as-is. Only the imports list at the top and the `LayoutBuilder` component change in this task.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manually verify**

Run: `npm run dev`. Build a small layout (split a few times until you have a frame that's small enough to make handles overlap). Switch to layout mode. Tap one of the small frames — the canvas should *snap* (no animation yet — that's the next task) so the selected frame fills most of the viewport with padding. Tapping the same frame again should zoom out one tree level via the existing depth-cycle. Tapping the back button doesn't exist yet — to reset, tap the root frame or refresh.

Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add src/layout-builder.tsx src/layout-builder.module.css
git commit -m "feat(layout-builder): apply constraint-driven canvas zoom on selection"
```

---

## Task 7: Animate the Viewport Transform

**Files:**
- Modify: `src/layout-builder.module.css`

- [ ] **Step 1: Add the transition rule**

In `src/layout-builder.module.css`, change the `.canvasInner` rule from:

```css
.canvasInner {
  position: absolute;
  inset: 0;
  display: flex;
  transform-origin: 0 0;
  will-change: transform;
}
```

to:

```css
.canvasInner {
  position: absolute;
  inset: 0;
  display: flex;
  transform-origin: 0 0;
  will-change: transform;
  transition: transform 220ms cubic-bezier(0.4, 0, 0.2, 1);
}
```

- [ ] **Step 2: Manually verify**

Run: `npm run dev`. Tap small frames in layout mode — the viewport should now slide and scale smoothly between selections instead of snapping.

Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add src/layout-builder.module.css
git commit -m "feat(layout-builder): animate viewport transitions"
```

---

## Task 8: Extend Notch Component with `orientation` Prop

The bottom mode bar's notch backdrop has `corner-top-shape: scoop` / `corner-bottom-shape: square` (bottom-attached look). The breadcrumb (top-attached) needs the inverse, and the contextual toolbar (right-attached) needs the rounded corners on the *left*. Adding an `orientation` prop to the `Notch` component is the cleanest way to express this without leaking hashed class names across module boundaries.

**Files:**
- Modify: `src/frame.tsx` (extend Notch props)
- Modify: `src/frame.module.css` (add orientation rules)

- [ ] **Step 1: Add the `orientation` prop to `Notch`**

In `src/frame.tsx`, replace the `Notch` component definition with:

```tsx
export function Notch(props: {
  ref?: (el: HTMLDivElement) => void
  style?: JSX.CSSProperties
  children: JSX.Element
  class: string
  onClick?(): void
  orientation?: "top" | "bottom" | "left" | "right"
}) {
  const orient = () => props.orientation ?? "bottom"
  return (
    <div
      ref={props.ref}
      class={[styles.notch, styles[`hud-${orient()}`], props.class]}
      style={props.style}
      onClick={e => e.stopPropagation()}
    >
      <div class={styles["notch-backdrop"]}>
        <div class={styles.edge} onClick={props.onClick} />
        <div class={styles.center} onClick={props.onClick} />
        <div class={styles.root} onClick={props.onClick} />
      </div>
      {props.children}
    </div>
  )
}
```

The new line is the second class added to the wrapper: `styles[\`hud-${orient()}\`]`. This is the hook the orientation CSS uses.

- [ ] **Step 2: Add orientation CSS to `frame.module.css`**

Append to `src/frame.module.css`:

```css
/*
 * HUD-orientation modifiers for the Notch component (used by bottomBar,
 * breadcrumb notch, contextual-toolbar notch).
 *
 * "hud-bottom" matches the existing bottomBar visual; explicit so other
 * orientations have a peer to mirror.
 */

.hud-bottom > .notch-backdrop > .root,
.hud-bottom > .notch-backdrop > .edge {
  corner-top-shape: scoop;
  corner-bottom-shape: square;
}

.hud-top > .notch-backdrop > .root,
.hud-top > .notch-backdrop > .edge {
  corner-top-shape: square;
  corner-bottom-shape: scoop;
}

.hud-right > .notch-backdrop {
  flex-direction: column;
  width: 100%;
  height: 100%;
}
.hud-right > .notch-backdrop > .root,
.hud-right > .notch-backdrop > .edge {
  flex: 0 var(--hud-radius);
}
.hud-right > .notch-backdrop > .root {
  corner-top-left-shape: scoop;
  corner-bottom-left-shape: scoop;
  corner-top-right-shape: square;
  corner-bottom-right-shape: square;
}
.hud-right > .notch-backdrop > .edge {
  corner-top-left-shape: scoop;
  corner-bottom-left-shape: scoop;
}

.hud-left > .notch-backdrop {
  flex-direction: column;
  width: 100%;
  height: 100%;
}
.hud-left > .notch-backdrop > .root,
.hud-left > .notch-backdrop > .edge {
  flex: 0 var(--hud-radius);
}
.hud-left > .notch-backdrop > .root {
  corner-top-right-shape: scoop;
  corner-bottom-right-shape: scoop;
  corner-top-left-shape: square;
  corner-bottom-left-shape: square;
}
```

> The existing `.notch-backdrop > .root` rule (with `corner-top-shape: scoop`) inside `.notch-backdrop {}` block stays in place — it is what `.hud-bottom` re-declares for symmetry. If a CSS conflict arises during implementation, prefer the new orientation rules (more specific selector chain) over the original.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manually verify the bottom bar still looks identical**

Run: `npm run dev`. Switch to layout mode. The bottom mode bar's notch shape should be unchanged (it now goes through the explicit `hud-bottom` path). Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add src/frame.tsx src/frame.module.css
git commit -m "feat(notch): add orientation prop for top/right/left HUD usage"
```

---

## Task 9: Move Breadcrumb into a Top Notch

**Files:**
- Modify: `src/layout-builder.tsx`
- Modify: `src/layout-builder.module.css`

- [ ] **Step 1: Replace the breadcrumb block in `layout-builder.module.css`**

In `src/layout-builder.module.css`, remove the legacy `.breadcrumb`, `.breadcrumb button`, `.breadcrumb button.active`, and `.breadcrumb .separator` rules and replace them with:

```css
.breadcrumbNotch {
  --notch-bg: #111;
  --backdrop-x: 0%;
  --backdrop-width: 100%;
  position: absolute;
  top: 0;
  left: 12px;
  height: var(--hud-height-notch);
  z-index: var(--z-hud);
}

.breadcrumbContent {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-inline: var(--hud-radius);
  height: 100%;
  color: var(--color-front);
  font-size: 13px;
  white-space: nowrap;
}

.breadcrumbContent button {
  background: none;
  border: none;
  padding: 0;
  color: var(--color-front);
  font-size: inherit;
  cursor: pointer;
}

.breadcrumbContent button.active {
  color: var(--color-selection);
  text-decoration: underline;
}

.breadcrumbContent .separator {
  user-select: none;
}
```

- [ ] **Step 2: Wrap Breadcrumb in a top-orientation Notch**

In `src/layout-builder.tsx`, update the imports to include `Notch`:

```tsx
import { ComponentProps, createEffect, createMemo, createSignal, For, Show, useContext } from "solid-js"
import { Context } from "./context"
import { Notch } from "./frame"
import styles from "./layout-builder.module.css"
import type { Node } from "./types"
import {
  computeViewportTransform,
  IDENTITY_VIEWPORT,
  selectedPathKey,
  transformToCss,
  type ViewportTransform,
} from "./viewport"
```

Then change the `Breadcrumb` component's `return (...)` from:

```tsx
return (
  <div class={styles.breadcrumb}>
    <For each={segments()}>
      ...
    </For>
  </div>
)
```

to:

```tsx
return (
  <Notch
    ref={el => context.setBreadcrumbEl(el)}
    class={styles.breadcrumbNotch}
    orientation="top"
  >
    <div class={styles.breadcrumbContent}>
      <For each={segments()}>
        {(seg, i) => (
          <>
            <Show when={i() > 0}>
              <span class={styles.separator}>&gt;</span>
            </Show>
            <button
              class={seg().depth === context.selection.depth ? styles.active : ""}
              onClick={() => context.setSelection(s => ({ ...s, depth: seg().depth }))}
            >
              {seg().label}
            </button>
          </>
        )}
      </For>
    </div>
  </Notch>
)
```

> The `setBreadcrumbEl` setter referenced above is added to the context in **Task 11**. Until then this code will not type-check; complete Task 11 before running the type-check step of this task. (The two tasks are intertwined; do them as a pair.)

- [ ] **Step 3: Defer verification until after Task 11**

This task changes the Breadcrumb's container; the `setBreadcrumbEl` reference is finalized in Task 11. Skip type-check + browser verification here and run them once Task 11 is complete.

- [ ] **Step 4: Stage but don't commit yet**

```bash
git add src/layout-builder.tsx src/layout-builder.module.css
```

(The combined commit happens in Task 11.)

---

## Task 10: ContextualToolbar Component

**Files:**
- Create: `src/contextual-toolbar.tsx`
- Create: `src/contextual-toolbar.module.css`

- [ ] **Step 1: Write the styles**

Create `src/contextual-toolbar.module.css`:

```css
.toolbarNotch {
  --notch-bg: #111;
  --backdrop-x: 0%;
  --backdrop-width: 100%;
  --backdrop-height: 100%;
  position: absolute;
  top: 12px;
  right: 0;
  width: var(--hud-height-notch);
  height: auto;
  z-index: var(--z-hud);
}

.toolbarContent {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding-block: var(--hud-radius);
  width: 100%;
  color: var(--color-front);
}

.toolbarButton {
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-front);
}
```

- [ ] **Step 2: Write the component**

Create `src/contextual-toolbar.tsx`:

```tsx
import { Show, useContext } from "solid-js"
import { Context } from "./context"
import { Notch } from "./frame"
import { BackIcon } from "./icons"
import styles from "./contextual-toolbar.module.css"

/**
 * Top-right floating toolbar. Hosts canvas-context buttons.
 * The notch only renders when at least one button is active —
 * an empty toolbar disappears entirely.
 */
export function ContextualToolbar() {
  const context = useContext(Context)!
  const hasSelection = () => context.selection.path.length > 0
  const hasAnyButton = () => hasSelection() // expand here as more buttons join

  return (
    <Show when={hasAnyButton()}>
      <Notch
        ref={el => context.setContextualToolbarEl(el)}
        class={styles.toolbarNotch}
        orientation="right"
      >
        <div class={styles.toolbarContent}>
          <Show when={hasSelection()}>
            <button
              class={styles.toolbarButton}
              onClick={() =>
                context.setSelection(() => ({ path: [], depth: 0 }))
              }
            >
              <BackIcon />
            </button>
          </Show>
        </div>
      </Notch>
    </Show>
  )
}
```

> The `setContextualToolbarEl` setter referenced above is added in **Task 11**.

- [ ] **Step 3: Stage but don't commit yet**

```bash
git add src/contextual-toolbar.tsx src/contextual-toolbar.module.css
```

(The combined commit happens in Task 11.)

---

## Task 11: Add HUD Element Refs to Context

This is the keystone task that makes Tasks 9 and 10 type-check. After this, Tasks 9–11 are committed together as one functional unit.

**Files:**
- Modify: `src/types.ts`
- Modify: `src/app.tsx`
- Modify: `src/layout-builder.tsx` (render `ContextualToolbar`)

- [ ] **Step 1: Extend `AppContext`**

In `src/types.ts`, change the `AppContext` definition from:

```ts
export type AppContext = {
  layout: Container
  selection: Selection
  setSelection: StoreSetter<Selection>
  appState: AppState
  setAppState: StoreSetter<AppState>
  bottomBarEl: Accessor<HTMLElement | undefined>
  setBottomBarEl: (el: HTMLElement | undefined) => void
  observeFrame: (el: HTMLElement, onResize: () => void) => () => void
}
```

to (note: in this codebase the type already uses `app/setApp`, not `appState/setAppState`; preserve whatever names currently exist there and just add the four new lines):

```ts
export type AppContext = {
  selection: Selection
  setSelection: StoreSetter<Selection>
  app: AppState
  setApp: StoreSetter<AppState>
  bottomBarEl: Accessor<HTMLElement | undefined>
  setBottomBarEl: (el: HTMLElement | undefined) => void
  breadcrumbEl: Accessor<HTMLElement | undefined>
  setBreadcrumbEl: (el: HTMLElement | undefined) => void
  contextualToolbarEl: Accessor<HTMLElement | undefined>
  setContextualToolbarEl: (el: HTMLElement | undefined) => void
  observeFrame: (el: HTMLElement, onResize: () => void) => () => void
}
```

- [ ] **Step 2: Provide the new accessors in `App`**

In `src/app.tsx`, find the existing `bottomBarEl` declaration:

```tsx
const [bottomBarEl, setBottomBarEl] = createSignal<HTMLElement | undefined>()
```

Add two more lines immediately below:

```tsx
const [breadcrumbEl, setBreadcrumbEl] = createSignal<HTMLElement | undefined>()
const [contextualToolbarEl, setContextualToolbarEl] = createSignal<HTMLElement | undefined>()
```

Then update the Context provider's `value` object so it includes them. Find:

```tsx
<Context
  value={{
    selection,
    setSelection,
    app,
    setApp: setApp,
    bottomBarEl,
    setBottomBarEl,
    observeFrame,
  }}
>
```

and change it to:

```tsx
<Context
  value={{
    selection,
    setSelection,
    app,
    setApp: setApp,
    bottomBarEl,
    setBottomBarEl,
    breadcrumbEl,
    setBreadcrumbEl,
    contextualToolbarEl,
    setContextualToolbarEl,
    observeFrame,
  }}
>
```

- [ ] **Step 3: Render ContextualToolbar inside LayoutBuilder**

In `src/layout-builder.tsx`, add the import:

```tsx
import { ContextualToolbar } from "./contextual-toolbar"
```

Then, inside `LayoutBuilder`'s JSX, add `<ContextualToolbar />` as a sibling of `<Breadcrumb />`:

```tsx
return (
  <div class={styles.layoutBuilder}>
    <div class={styles.canvas} ref={canvasEl}>
      <div
        class={styles.canvasInner}
        ref={innerEl}
        style={{ transform: transformToCss(transform()) }}
      >
        {props.children}
      </div>
      <Breadcrumb />
      <ContextualToolbar />
    </div>
  </div>
)
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. Tasks 9, 10, 11 now compile together.

- [ ] **Step 5: Manually verify**

Run: `npm run dev`. In layout mode:
- Breadcrumb appears as a top-left notch attached to the top edge.
- After tapping a frame, a top-right notch appears with the back arrow inside.
- Tapping the back arrow clears selection (path → []) and the top-right notch disappears.

Stop dev server.

- [ ] **Step 6: Commit Tasks 9, 10, 11 together**

```bash
git add src/types.ts src/app.tsx src/contextual-toolbar.tsx src/contextual-toolbar.module.css src/layout-builder.tsx src/layout-builder.module.css
git commit -m "feat(hud): unify breadcrumb + contextual toolbar on notched language"
```

---

## Task 12: Extend Frame Collision Detection to Breadcrumb and Contextual Toolbar

The frame's bottom-pointing add-handle already extends to bridge the bottom mode bar. Top-pointing handles need the same against the breadcrumb; right-pointing against the contextual toolbar.

**Files:**
- Modify: `src/frame.tsx`

- [ ] **Step 1: Replace the single-element overlap state with a per-direction state**

In `src/frame.tsx`, find:

```tsx
const [bottomExtend, setBottomExtend] = createSignal(0)
let frameRef!: HTMLDivElement

function checkOverlap() {
  const bar = context.bottomBarEl()
  if (!bar || !frameRef) {
    setBottomExtend(0)
    return
  }
  const frameRect = frameRef.getBoundingClientRect()
  const barRect = bar.getBoundingClientRect()
  const verticalOverlap = frameRect.bottom > barRect.top + 1
  const notchCenterX = (frameRect.left + frameRect.right) / 2
  const horizontalOverlap = notchCenterX + 50 > barRect.left && notchCenterX - 50 < barRect.right
  setBottomExtend(verticalOverlap && horizontalOverlap ? barRect.height : 0)
}
```

and replace it with:

```tsx
const [bottomExtend, setBottomExtend] = createSignal(0)
const [topExtend, setTopExtend] = createSignal(0)
const [rightExtend, setRightExtend] = createSignal(0)
let frameRef!: HTMLDivElement

function overlapWithBottom(bar: HTMLElement | undefined) {
  if (!bar || !frameRef) return 0
  const frameRect = frameRef.getBoundingClientRect()
  const barRect = bar.getBoundingClientRect()
  const verticalOverlap = frameRect.bottom > barRect.top + 1
  const notchCenterX = (frameRect.left + frameRect.right) / 2
  const horizontalOverlap = notchCenterX + 50 > barRect.left && notchCenterX - 50 < barRect.right
  return verticalOverlap && horizontalOverlap ? barRect.height : 0
}

function overlapWithTop(bar: HTMLElement | undefined) {
  if (!bar || !frameRef) return 0
  const frameRect = frameRef.getBoundingClientRect()
  const barRect = bar.getBoundingClientRect()
  const verticalOverlap = frameRect.top < barRect.bottom - 1
  const notchCenterX = (frameRect.left + frameRect.right) / 2
  const horizontalOverlap = notchCenterX + 50 > barRect.left && notchCenterX - 50 < barRect.right
  return verticalOverlap && horizontalOverlap ? barRect.height : 0
}

function overlapWithRight(bar: HTMLElement | undefined) {
  if (!bar || !frameRef) return 0
  const frameRect = frameRef.getBoundingClientRect()
  const barRect = bar.getBoundingClientRect()
  const horizontalOverlap = frameRect.right > barRect.left + 1
  const notchCenterY = (frameRect.top + frameRect.bottom) / 2
  const verticalOverlap = notchCenterY + 50 > barRect.top && notchCenterY - 50 < barRect.bottom
  return horizontalOverlap && verticalOverlap ? barRect.width : 0
}

function checkOverlap() {
  setBottomExtend(overlapWithBottom(context.bottomBarEl()))
  setTopExtend(overlapWithTop(context.breadcrumbEl()))
  setRightExtend(overlapWithRight(context.contextualToolbarEl()))
}
```

- [ ] **Step 2: Update `createEffect(context.bottomBarEl, checkOverlap)` to also re-run for the new HUD elements**

Change:

```tsx
createEffect(context.bottomBarEl, checkOverlap)
onSettled(() => context.observeFrame(frameRef, checkOverlap))
```

to:

```tsx
createEffect(() => {
  context.bottomBarEl()
  context.breadcrumbEl()
  context.contextualToolbarEl()
  checkOverlap()
})
onSettled(() => context.observeFrame(frameRef, checkOverlap))
```

> Note: The two-arg `createEffect` form used elsewhere in this file is being swapped here for the single-arg form because we now have multiple reactive sources to track. If your Solid version's two-arg form supports an array source, prefer that — otherwise the single-arg form is correct.

- [ ] **Step 3: Apply the new extend signals to the top and right ArrowNotches**

Find the existing `<Show when={dirs().includes("top")}>` block:

```tsx
<Show when={dirs().includes("top")}>
  <Show
    when={buttonDirs().includes("top")}
    fallback={<ArrowNotch class={styles.top} onClick={() => props.onAddFrame("top")} />}
  >
    <EdgeButton class={styles.top} onClick={() => props.onAddFrame("top")} />
  </Show>
</Show>
```

and replace the `<ArrowNotch>` line so it conditionally sets `--extend`:

```tsx
<Show when={dirs().includes("top")}>
  <Show
    when={buttonDirs().includes("top")}
    fallback={
      <ArrowNotch
        class={styles.top}
        style={topExtend() > 0 ? { "--extend": `${topExtend()}px` } : undefined}
        onClick={() => props.onAddFrame("top")}
      />
    }
  >
    <EdgeButton class={styles.top} onClick={() => props.onAddFrame("top")} />
  </Show>
</Show>
```

Find the `<Show when={dirs().includes("right")}>` block and apply the same pattern:

```tsx
<Show when={dirs().includes("right")}>
  <Show
    when={buttonDirs().includes("right")}
    fallback={
      <ArrowNotch
        class={styles.right}
        style={rightExtend() > 0 ? { "--extend": `${rightExtend()}px` } : undefined}
        onClick={() => props.onAddFrame("right")}
      />
    }
  >
    <EdgeButton class={styles.right} onClick={() => props.onAddFrame("right")} />
  </Show>
</Show>
```

(Bottom is already wired with `bottomExtend` in the existing code; left has no HUD on its side and stays unchanged.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manually verify**

Run: `npm run dev`. Build a layout where a frame's edge sits behind the breadcrumb (top edge of canvas) or behind the contextual toolbar (right edge), then enter split mode and select that frame. The relevant arrow handle should extend visually to bridge the HUD element, the same way the bottom handle currently bridges the mode bar.

Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add src/frame.tsx
git commit -m "feat(frame): extend top/right add-handles to bridge breadcrumb and toolbar"
```

---

## Task 13: Recompute Viewport on Window Resize

If the user rotates the device or otherwise resizes the canvas, the viewport's transform stays correct only if the math reruns. We already have a shared resize plumbing — extend the recompute effect to depend on a resize tick.

**Files:**
- Modify: `src/layout-builder.tsx`

- [ ] **Step 1: Add a resize tick to the LayoutBuilder effect**

In `src/layout-builder.tsx`, change the `LayoutBuilder` component to track its canvas size via `observeFrame` (which already responds to window resize and the bottom bar resize). Replace the existing `createEffect(...)` block inside `LayoutBuilder` with:

```tsx
const [resizeTick, setResizeTick] = createSignal(0)

createEffect(() => {
  if (!canvasEl) return
  const cleanup = context.observeFrame(canvasEl, () => setResizeTick(t => t + 1))
  return cleanup
})

createEffect(() => {
  // Track sources that should trigger a recompute.
  resizeTick()
  const key = selectedPathKey(context.selection)

  if (!innerEl || !canvasEl) return

  if (key === "") {
    setTransform(IDENTITY_VIEWPORT)
    return
  }

  const node = innerEl.querySelector<HTMLElement>(`[data-path="${key}"]`)
  if (!node) {
    setTransform(IDENTITY_VIEWPORT)
    return
  }

  const rect = canvasEl.getBoundingClientRect()
  setTransform(computeViewportTransform(node, innerEl, rect.width, rect.height))
})
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manually verify**

Run: `npm run dev`. Tap a small frame so the canvas zooms in. Resize the browser window — the viewport should recompute and the selected frame should remain centered with appropriate zoom. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add src/layout-builder.tsx
git commit -m "feat(layout-builder): recompute viewport on canvas resize"
```

---

## Self-Review Checklist (run before handing off)

- **Spec coverage:**
  - "Selection drives the viewport" → Tasks 5, 6, 13.
  - "Tap behavior preserved" → Tasks 4 + 6 (no change to tap logic; viewport just follows existing selection).
  - "Containers as selectable nodes" → Task 4 (every node has `data-path`); Task 5 math doesn't distinguish entity vs. container.
  - "HUD: notched language everywhere" → Tasks 8, 9, 10, 11.
  - "Contextual toolbar hidden when no tools" → Task 10 (`<Show when={hasAnyButton()}>`).
  - "Back button" → Task 10 (renders inside the toolbar; clears selection on tap).
  - "Constraint detection" → Task 2 (constants), Task 5 (math).
  - "Animation" → Task 7.
  - "Handle collisions with HUD notches" → Task 12.
- **Placeholder scan:** No "TBD" / "TODO" / "implement later" present in code blocks. Verify by re-reading.
- **Type consistency:** `setBreadcrumbEl` / `setContextualToolbarEl` defined in Task 11 are used in Tasks 9 & 10 (Tasks 9–11 commit together).

---

## Notes for Implementer

- This codebase uses Solid 2.x. There is no test framework configured; verification is `npx tsc --noEmit` plus browser smoke tests. Don't introduce a test framework as part of this plan.
- The existing two-arg `createEffect(source, callback)` pattern is used in `frame.tsx` and a few other places; preserve it where it already works. Use the single-arg form when an effect needs to track multiple sources.
- The `--extend` CSS variable convention is already in `frame.module.css` — extend uniformly across all four directions; no new CSS variables needed.
- When tuning `MIN_NODE_WIDTH`/`HEIGHT`, measure the actual rendered footprint of handles + edge buttons in the worst case (split mode on a frame that gets all four handles) and add comfortable interior space.
