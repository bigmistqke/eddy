# Unified Arrows + Center Swap Design

## Problem

Today the layout builder has two distinct modes — `append` and `split` — toggled from the bottom bar. They differ both in interaction and in semantics:

- **Split** targets the selected frame and shows arrow notches on all 4 edges; tapping nests the frame in a new container with a sibling.
- **Append** targets the selected container and shows round `+` buttons in the gaps between its children; tapping inserts a sibling at that gap.

Two problems compound:

1. The append model "click container, then add anywhere inside" doesn't scale. A container with many children crowds its inter-child `+` buttons until they overlap, and there's no clear UI fallback.
2. The append-vs-split mode toggle is mental overhead for an operation users think of as one thing: "add a frame next to this one."

The split and append operations differ along perpendicular axes — append along the parent's flex axis (sibling), split along the cross axis (nest). That symmetry is hidden by the mode-bar UI; surfacing it lets both fit on a single frame as 4 directional handles, distinguished by icon, with no toggle needed.

## Goals

- Eliminate the `append`/`split` mode toggle.
- Always show 4 directional handles on the selected frame, with the icon disambiguating the operation per axis.
- Add a center "swap container direction" button so the resolved-axis state (currently hidden in `splitNode`'s sole-child special-case) becomes explicit and tappable.
- Reuse the existing constraint-zoom and edge-stick infrastructure for all 5 controls.

## Non-goals

- Changing what split or append actually do (the mutations in `appendToContainer` and `splitNode` stay the same).
- Reworking the breadcrumb, viewport math beyond a single new constraint, or the bottom bar's recording-view contents.
- Adding new modes (e.g., delete, move). Future-scope.

## Behavioral changes

### Selecting a frame

Unchanged: tap a frame to select it. `selection.depth` defaults to `0` (the leaf). Breadcrumb segments still drive ancestor scoping.

### Selected frame controls

The selected frame shows 5 controls when in layout view:

| Control | Position | Icon | Operation |
|---|---|---|---|
| Top arrow | Top edge notch | `+` if parent direction is vertical, split otherwise | Append (axis-match) or Split (cross) |
| Bottom arrow | Bottom edge notch | same logic | same |
| Left arrow | Left edge notch | `+` if parent direction is horizontal, split otherwise | same |
| Right arrow | Right edge notch | same logic | same |
| Swap button | Center | swap icon | Swap parent.direction (or root.direction for root) |

**Icon-to-operation rule:** an arrow whose axis matches the parent container's flex direction shows `+` and performs append. An arrow on the cross axis shows the split icon and performs split (the existing `splitNode` behavior, including the sole-child and root-empty-path special cases).

For a horizontal parent, left/right show `+` (append), top/bottom show split. For a vertical parent, top/bottom show `+`, left/right show split. For root: parent = root itself, so the same rule applies using `root.direction`. Root cross-axis split uses `splitNode`'s empty-path branch (which wraps existing children before inserting).

### Center swap button

Always visible on the selected frame. Toggles the *parent's* direction:

- For a non-root selection: parent's `direction` flips between `horizontal` and `vertical`. Existing siblings restack along the new axis.
- For root selection: `root.direction` flips. Existing children restack.

Multi-child case is intentional (per user): swap is universally available, not gated to sole-child. Mid-tap restacking is the price of one-tap rotation.

### Modes go away

- `app.view`: `{ type: "recording" } | { type: "layout"; mode: "append" | "split" }` becomes `{ type: "recording" } | { type: "layout" }`.
- The two mode buttons disappear from the bottom bar in layout view. Only the close button remains.
- Recording view's `+` button enters layout mode (no longer "append mode" specifically).
- `enterAppendMode` becomes `enterLayoutMode` (or inline). The `if (selection.depth === 0) setSelection(s => ({ ...s, depth: 1 }))` defaulting in that handler is removed — append now targets the selected frame's own slot, no parent-scope shortcut needed.

## Constraint-zoom update

`computeViewportTransform` already ensures 4 edge handles fit without pairwise overlap. Add a 5th constraint: the center swap button plus clearance from the inner edges of the 4 handles.

Defining `SWAP_W` and `SWAP_H` (initial values: `SWAP_W = HANDLE_W = 100`, `SWAP_H = HANDLE_H = 60`) and reusing `HANDLE_BUFFER = 20` as clearance:

```
SWAP_FIT_W = SWAP_W + 2·HANDLE_H + 2·HANDLE_BUFFER  = 260
SWAP_FIT_H = SWAP_H + 2·HANDLE_H + 2·HANDLE_BUFFER  = 220
```

The new `handleScale` formula:

```ts
handleScale = max(
  SAME_AXIS_MIN / nw,
  SAME_AXIS_MIN / nh,
  min(CROSS_PAIR_MIN / nw, CROSS_PAIR_MIN / nh),
  SWAP_FIT_W / nw,
  SWAP_FIT_H / nh,
)
```

The constraint stays a single scalar, so the rest of the viewport pipeline (signal shape, animation, edge-sticking) is unaffected.

## What stays

- Edge-sticking logic (clamps off-screen handles to viewport edges) — applies uniformly to the 4 arrow notches in unified mode.
- Constraint-zoom infrastructure (`viewport.ts`, the post-animation settle, `isAnimating` lockdown).
- Breadcrumb minimap, contextual toolbar (back button on zoom), per-frame collision check for HUD overlaps, frame-tap selection.
- The mutation functions `appendToContainer` and `splitNode` — semantics unchanged. The swap-direction operation is a small new mutation (one-line: flip the container's `direction` field).

## Architecture

### `src/types.ts`

Drop the `mode` field from `AppView`:

```ts
export type AppView = { type: "recording" } | { type: "layout" }
```

### `src/app.tsx`

- Remove `enterAppendMode`'s depth-defaulting; rename to `enterLayoutMode`.
- Bottom bar layout-view branch: only the close button.
- Add `swapDirection(path: number[])`: resolves the parent container (or root for empty path), flips `direction`. Single setter call.
- `handleAppend` and `splitNode` unchanged. Plumb a single `onAddFrame(path, direction, op: "append" | "split")` callback through `NodeComponent` → `Frame`, since the frame now reports both. (Or keep two separate callbacks; equivalent. Picked single-callback for fewer prop threads.)

### `src/node-component.tsx`

- `handles()` memo: when `app.view.type === "layout"` and the frame is the selected leaf, return all 4 directions with per-direction op:

  ```ts
  type HandleSpec = { dir: Direction; op: "append" | "split" }
  ```

- The icon-per-direction is derived from the parent's `direction`:
  - Parent direction matches arrow axis → `op: "append"`
  - Parent direction is cross to arrow axis → `op: "split"`

- For the root frame, parent = root itself; same rule using `root.direction`.

- The old per-gap append-button rendering (the `buttons` field, computed via the `handles` memo's append-mode branch) is removed entirely. `Frame`'s `buttonDirections` prop is no longer needed and is removed.

### `src/frame.tsx`

- Accept `handles: HandleSpec[]` (replacing `handleDirections` + `buttonDirections`).
- Per direction: render an `ArrowNotch` whose icon is `<PlusIcon>` or `<SplitIcon>` based on `op`. Click delegates to `onAddFrame(dir, op)`.
- Always render a center swap button when `handles` is non-empty (i.e., this is the selected frame). Click delegates to a new `onSwapDirection()` callback.
- The center button is a positioned absolute element inside the frame, centered, with size `SWAP_W × SWAP_H` (CSS variables tied to the same constants).

### `src/frame.module.css`

- Add `.swap-button` rules: position absolute, top/left 50%, translate -50%/-50%, fixed CSS pixel size, styled like the existing `EdgeButton` (round, dark background, accent on hover).

### `src/icons.tsx`

- Add `SwapIcon` — two perpendicular arrows (one horizontal, one vertical) intersecting in an "X+" shape, or a 90° rotation glyph. Picked at implementation time from those two; the constraint is "reads as swap-orientation." Sized to fit inside the swap button's `SWAP_W × SWAP_H` bounds.

### `src/viewport.ts`

- Add `SWAP_W`, `SWAP_H`, `SWAP_FIT_W`, `SWAP_FIT_H` constants.
- Update `computeViewportTransform`'s `handleScale` calculation per the formula above.

### Removed code

- `app.tsx`: `enterAppendMode`'s `depth` defaulting, the two `ModeButton` JSX blocks, the `mode` reads in `<Match>` blocks.
- `node-component.tsx`: the entire `mode === "append"` branch in `handles()` (the parent-relationship-checking, `isFirst`/`isLast` calculation for inter-gap buttons), `buttonDirections` plumbing.
- `frame.tsx`: `buttonDirections` prop, `<Show when={buttonDirs().includes(...)}>` branches, the `EdgeButton` component invocations *inside* directional handle rendering. The `EdgeButton` component itself stays for the new center swap button.
- `types.ts`: `mode` field on `AppView`.

## Edge cases

### Selected frame too small for swap button

The new constraint-zoom rule ensures the selected frame is always large enough for the swap button to fit. If the frame is small enough that the constraint fires, the canvas zooms in until it fits.

### Off-screen edges with extreme aspect

The edge-sticking logic from the previous spec covers the 4 arrows. The center swap button is intrinsically near the frame's center, so it stays on-screen as long as constraint-zoom keeps the frame's center near the canvas viewport's center — which it always does (the viewport translation centers the selected node).

### Swap on a sole-child container

Sole-child container's direction has no visual effect (one cell fills regardless). After swap, the next append/split operation reflects the new direction. This makes the previously-implicit "axis decision happens inside `splitNode`'s special case" explicit and user-driven. The special case in `splitNode` itself is preserved (still does the right thing if reached via cross-axis arrow), but is no longer the only path to set parent direction.

### Recording view

Unchanged. Plus / Record / Play. Plus enters layout mode.

## Testing

Manual UAT:

1. Enter layout mode. Tap a frame in a horizontal parent. Verify 4 arrows appear: left/right show `+`, top/bottom show split icon. Center shows swap button.
2. Tap the right arrow. New sibling appears to the right of the tapped frame.
3. Tap the top arrow on the same frame. Frame is wrapped in a new vertical container with a sibling above.
4. Tap a frame in a vertical parent. Verify icons swap (top/bottom = `+`, left/right = split).
5. Tap a frame, then tap the center swap button. Parent's direction flips; siblings restack along the new axis.
6. Tap the root (via breadcrumb root segment). Verify all 4 arrows appear with icons appropriate to root's current direction. Tap a cross-axis arrow on root: existing children get wrapped in a new inner container; new sibling joins at root level.
7. Resize the window so the canvas is small. Verify constraint-zoom now zooms in further (because of the new SWAP_FIT constraints) so all 5 controls fit.
8. Tap a frame whose aspect is extreme. Verify edge-sticking still clamps the off-screen pair of arrows to the viewport edges.
