# Centralized Layout Pass Design

## Problem

Three subsystems read DOM geometry independently and disagree about it:

- `viewport.ts` decides scale and translation, reading `node.offsetWidth/Top` via `offsetRelativeToRoot`.
- Each frame in `frame.tsx` runs `checkAllHandles`, computing per-direction extends (HUD overlap) and sticks (off-screen clamping) from `getBoundingClientRect()` calls on its handles, the frame, the HUDs, and the canvas. This fires on every change in a 9-signal tuple plus a per-frame `ResizeObserver`.
- The collision registry in `app.tsx` (`registerCollidable`, `findCollisions`, `registerUpdateCollision`) tracks all handles and HUDs and exists solely to feed `checkAllHandles`.

Two consequences:

1. **Performance.** Every frame in the layout tree runs collision math on every signal change, even though only the *selected* frame ever displays handles. Deeply nested frames (e.g., 30-frame tree) compound this into many cascaded `getBoundingClientRect` calls per zoom or resize.

2. **Correctness.** The viewport zoom decides scale based on raw `HANDLE_W`/`HANDLE_H` constraints. The frame's post-animation `checkAllHandles` then discovers HUD overlap and applies extends. The two systems compute against different geometry snapshots taken at different times, so the final zoomed state can leave the bottom handle underneath the bottom bar.

The layout itself is purely a function of the `app.layout` tree plus canvas size — flex with `flex: 1` everywhere, fixed gap, root-only padding. Reading the DOM to recover that geometry is wasted work.

## Goals

- One function, owned by `layout-builder.tsx`, decides scale, translation, extends, and sticks from a single geometry snapshot.
- Frame geometry is computed analytically from the layout tree, not measured from the DOM.
- Center on the *effective* canvas (canvas minus HUD insets), not the raw viewport center, so asymmetric HUD placements don't bias the centering.
- Handles never hidden as a fallback (already true on `feature/handle-fit`).
- Prepare for a future non-DOM (WebGL) renderer: the same `frameRect` function works regardless of draw target.

## Non-goals

- Keeping the collision registry. It exists only to feed handle math; centralizing handle math removes its only consumer. (Future drag/snap features can reintroduce a similar mechanism scoped to their needs.)
- Per-frame `ResizeObserver` for collision purposes. Layout topology and canvas size are the only inputs that matter; both have direct subscriptions.
- New behaviors. This refactor preserves current visible behavior and fixes the two bugs above as side effects.
- Changing how HUDs render or where they live.

## Architecture

### Single function

```ts
function layoutPass(): void
```

Owned by `LayoutBuilder` in `src/layout-builder.tsx`. Triggers:

- `context.selection` change (signal subscription).
- `app.layout` change (store subscription — covers split / append / mode-driven mutations).
- Canvas resize (`ResizeObserver` on `canvasEl`).
- HUD insets change (HUD elements come and go with `isCanvasZoomed`; the resize observer also fires when their layout shifts).

Does not run during the canvas zoom animation. The existing `isAnimating` lockdown stays in place; `layoutPass` short-circuits while `context.isAnimating()` is true and runs once on settle.

### Inputs

Read from reactive sources at the top of `layoutPass`:

- `app.layout` — the layout tree.
- `context.selection` — `{ path, depth }`.
- `canvasSize` — cached `{ w, h }` from the most recent `canvasEl.getBoundingClientRect()`. Refreshed only by the canvas `ResizeObserver`.
- `hudInsets` — cached `{ top, right, bottom, left }`. Each value is how far that HUD intrudes into the canvas viewport from its respective canvas edge. `top` from breadcrumb, `bottom` from bottom bar, `right` from contextual toolbar (0 when not present), `left` always 0. Refreshed by the canvas `ResizeObserver`.

### Computation (pure)

All steps below are pure functions of the inputs. No DOM reads.

1. **Resolve selected path.** `selectedPath = selection.path.slice(0, selection.path.length - selection.depth)`. Empty path means "root scope"; empty result key means "no selection" (back-button cleared) — emit identity transform and clear handles state.

2. **Compute base rect.** `baseRect = frameRect(app.layout, selectedPath, canvasSize)`.

3. **Compute scale.** `scale = handleFitScale(baseRect.w, baseRect.h)` — existing same-axis / cross-pair math.

4. **Natural-fit short-circuit.** If `scale ≤ 1` and the base rect's natural position has acceptable extends (no same-axis-pair overlap), emit `IDENTITY_VIEWPORT` for the viewport and `{ extend: 0s, stick: 0s }` for handles.

5. **Compute translation.** `translation = panToEffectiveCenter(baseRect, scale, canvasSize, hudInsets)`. Effective center is `((leftHud + canvasW − rightHud) / 2, (topHud + canvasH − bottomHud) / 2)`. Translation places the post-scaled frame's center at effective center.

6. **Compute post-transform rect.** `postRect = applyTransform(baseRect, scale, translation)` — pure arithmetic.

7. **Compute extends.** Per-direction overlap of `postRect` with the corresponding HUD:
   - `top = max(0, hudInsets.top − postRect.top)`
   - `bottom = max(0, postRect.bottom − (canvasH − hudInsets.bottom))`
   - `left = max(0, hudInsets.left − postRect.left)`
   - `right = max(0, postRect.right − (canvasW − hudInsets.right))`

8. **Compute sticks.** Per-direction overflow of `postRect` past canvas bounds:
   - `top = max(0, − postRect.top)`
   - `bottom = max(0, postRect.bottom − canvasH)`
   - `left = max(0, − postRect.left)`
   - `right = max(0, postRect.right − canvasW)`

### Outputs (context signals)

Two signals drive UI state:

- `viewport: { scale, x, y, baseW, baseH }` — drives `canvasInner` transform and sizing. Existing.
- `selectedHandlesState: { extend: Record<Direction, number>, stick: Record<Direction, number> }` — new. The currently selected `Frame` reads this and applies values via `--extend` / `--stick` CSS variables. Non-selected frames render no handles, so they ignore it.

### `frameRect` — analytical layout math

```ts
function frameRect(
  layout: Container,
  path: number[],
  canvas: { w: number; h: number },
): { x: number; y: number; w: number; h: number }
```

Walks the path from root. Mirrors the CSS flex layout: every container has `display: flex` with all children at `flex: 1`. Root container has `padding: ROOT_PADDING` and `gap: SIBLING_GAP` between children. Non-root containers have only `gap: SIBLING_GAP`.

Algorithm:

```
rect = { x: ROOT_PADDING, y: ROOT_PADDING, w: canvas.w - 2*ROOT_PADDING, h: canvas.h - 2*ROOT_PADDING }
current = layout
for i, idx in enumerate(path):
  n = current.children.length
  totalGap = SIBLING_GAP * (n - 1)
  if current.direction == "horizontal":
    childW = (rect.w - totalGap) / n
    rect = { x: rect.x + idx * (childW + SIBLING_GAP), y: rect.y, w: childW, h: rect.h }
  else:
    childH = (rect.h - totalGap) / n
    rect = { x: rect.x, y: rect.y + idx * (childH + SIBLING_GAP), w: rect.w, h: childH }
  current = current.children[idx]
return rect
```

Pure function. Easily unit-testable. WebGL-renderer-ready.

### Frame.tsx (view-only)

Frame becomes a presentation component:

- Reads `context.selectedHandlesState` and `context.selection`.
- Determines `isSelected` by comparing its path to the selection's targeted path.
- If selected, applies extends and sticks from `selectedHandlesState` via inline `--extend` / `--stick` CSS variables on the four arrow notches (handles still render per the existing `handles: HandleSpec[]` prop, which `node-component.tsx` already produces correctly).
- If not selected, renders nothing for handles.

Removed from `frame.tsx`:

- `extendByDir`, `stickByDir`, `handlesHidden` signals.
- `checkAllHandles` and `overlapAmount`.
- The 9-signal tuple `createEffect`.
- `observeFrame` subscription for collision purposes.
- The four `topEl`/`bottomEl`/`leftEl`/`rightEl` signal-driven refs and `registerCollidable` calls. (Refs stay only where needed for click handling; they no longer feed a registry.)
- `visibleCollidable` helper.

## Constants

`src/ui-constants.ts` becomes the single source for constants mirroring CSS values:

```ts
// Handle dimensions (mirror frame.module.css notch geometry)
export const HANDLE_W = 100
export const HANDLE_H = 60
export const HANDLE_BUFFER = 20
export const SAME_AXIS_MIN = 2 * HANDLE_H + HANDLE_BUFFER
export const CROSS_PAIR_MIN = HANDLE_W + 2 * HANDLE_H + HANDLE_BUFFER

// Layout (mirror app.module.css and index.css)
export const ROOT_PADDING = 4   // .layoutContainerRoot padding + gap
export const SIBLING_GAP = 4    // .layoutContainer gap

// HUDs (mirror index.css and the per-HUD CSS modules)
export const HUD_HEIGHT = 60    // breadcrumb (top), bottom bar (bottom)
export const HUD_WIDTH = 60     // contextual toolbar (right, when visible)
```

`VIEWPORT_PADDING` (currently `24`, unused) is removed.

These constants must stay in sync with their CSS counterparts. The risk is acceptable because:

- The values are stable design tokens, not user-tunable.
- A second consumer (the WebGL renderer) will need them programmatically anyway.
- A future settings layer can read them from CSS once if drift becomes a problem.

## Removed code

### From `src/app.tsx`

- `Collidable` set (`collidables`).
- `updateSubscribers` set.
- `registerCollidable`, `notifyCollisionUpdate`, `requestCollisionUpdate`, `registerUpdateCollision`.
- `findCollisions`.
- `frameCallbacks` set, the corresponding `ResizeObserver` plumbing, and `observeFrame`.
- `canvasEl` / `setCanvasEl` signal (no longer consumed; layout-builder owns its own ref).
- The `createEffect(bottomBarEl, ...)` that registers the bottom bar as collidable.

### From `src/types.ts`

- `canvasEl`, `setCanvasEl`.
- `registerCollidable`, `findCollisions`, `registerUpdateCollision`, `requestCollisionUpdate`, `observeFrame`.

Added:
- `selectedHandlesState: Accessor<{ extend: Record<Direction, number>; stick: Record<Direction, number> }>`.
- `setSelectedHandlesState` (setter).

### From `src/frame.tsx`

- Per-frame collision logic listed above.

### Deleted

- `src/collision.ts`.

## File touchpoints

| File | Change |
|---|---|
| `src/ui-constants.ts` | Consolidate constants; remove unused `VIEWPORT_PADDING` |
| `src/viewport.ts` | Add `frameRect`, `applyTransform`, `computeExtends`, `computeSticks`. `computeViewportTransform` uses analytical geometry; `offsetRelativeToRoot` deleted |
| `src/layout-builder.tsx` | Implement `layoutPass`; own a local `ResizeObserver` on the canvas (replacing the context-shared `observeFrame`); subscribe to `selection`, `app.layout`, canvas resize; cache `canvasSize` and `hudInsets` |
| `src/frame.tsx` | Reduce to view-only; read `selectedHandlesState` |
| `src/types.ts` | Update `AppContext` per "Removed code" |
| `src/app.tsx` | Remove collision registry and related plumbing |
| `src/collision.ts` | Delete |

## Edge cases

### No selection (back button cleared)

`selectedPath` is empty. `layoutPass` emits `IDENTITY_VIEWPORT` and clears handle state. Same as today.

### Root scope (selection.depth === selection.path.length)

`selectedPath = []`. `frameRect(app.layout, [], canvasSize)` returns the root container's rect (canvas minus root padding). All other math runs normally; root is treated as its own selectable frame.

### Selection on a container (depth > 0)

Same as a leaf — `frameRect` walks to whatever depth `selectedPath` reaches. No special case.

### Frame too tall/wide for visible region (degenerate)

`scale` is bounded below by handle-fit math. If even at that scale the frame exceeds the effective canvas, `extends` and `sticks` will be non-zero. Handles still render with their CSS-applied extends/sticks; the result may visually overlap, but per the "never hide handles" rule, that's accepted.

### HUD insets change mid-session

The contextual toolbar appears/disappears with `isCanvasZoomed`. When it does, the canvas's effective region changes. The next `layoutPass` (triggered by selection change, resize, or zoom completion) recomputes against the new HUD insets. If a layout pass fires *during* the appearance/disappearance and the toolbar's collidable rect hasn't settled, the next pass corrects it.

### Layout topology mutation

Adding or removing a frame changes `app.layout`. `layoutPass` subscribes to the store, so it fires automatically. The selected path may now point to a different frame (e.g., the new entity after split); selection logic in `app.tsx` handles that transition (already works today).

### Per-direction CSS values

Frame applies `extend` and `stick` via inline CSS variables (`--extend`, `--stick`) on each ArrowNotch. The CSS rules in `frame.module.css` already consume these values; no CSS changes needed.

## Testing

Manual UAT after the refactor:

1. Tap a center frame in a balanced layout — no pan, no zoom (preserved behavior).
2. Tap a bottom-row frame whose natural position would overlap the bottom HUD — canvas pans to effective center; bottom handle clears the HUD.
3. Tap a deeply nested frame (4+ levels) — viewport recomputes once, no per-frame cascades. Verify in DevTools Performance tab if needed.
4. Zoom into a frame, then resize the window — `layoutPass` re-runs, viewport adjusts, handle extends/sticks update correctly.
5. With contextual toolbar visible (canvas zoomed), tap a frame to the right side of the canvas — frame centers on effective canvas (offset to the left to honor the right HUD); right handle stays visible.
6. Append a sibling — selection moves to the new entity; `layoutPass` fires from `app.layout` change; new entity is centered.
7. Edge-stick scenario: select a frame whose aspect is so extreme that one handle pair would land off-canvas — sticks pull them flush with the canvas edges.

## Implementation order

The refactor can be done in two stages, each shippable:

**Stage A:** Centralize the compute. Implement `layoutPass`, add `selectedHandlesState`, simplify `frame.tsx` to view-only. The old per-frame `checkAllHandles` is deleted in this stage. The collision registry becomes dead code.

**Stage B:** Delete the dead collision registry: remove `registerCollidable`, `findCollisions`, `registerUpdateCollision`, `requestCollisionUpdate`, `observeFrame`, the `Collidable` set, `frameCallbacks`, `updateSubscribers`, the `canvasEl`/`setCanvasEl` context plumbing, and `src/collision.ts`. Update `types.ts` accordingly.

Splitting is optional — both stages can be one PR. The split exists as a safety valve if Stage A reveals an unexpected consumer of the registry.
