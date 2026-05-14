import { HANDLE_H, HANDLE_W } from "./constants"
import type { Direction, HudOrientation, Node, Rgb, Selection } from "./types"
import { pathEquals } from "./utils"

/**
 * `scale` is the *size multiplier* applied to the canvas by setting
 * `width = canvasW * scale; height = canvasH * scale` on the layout root —
 * NOT a CSS `transform: scale()`. We expand the layout to its real pixel
 * dimensions so flex children grow at native resolution; text and SVG stay
 * crisp. Handles (with fixed CSS sizes) automatically stay at viewport size
 * because they are not scaled by anything — there is no inverse-scale needed.
 *
 * `x`/`y` are the translation applied to the (now-larger) layout root so the
 * selected node lands at the canvas viewport center.
 */
export type ViewportTransform = { scale: number; x: number; y: number }

export const IDENTITY_VIEWPORT: ViewportTransform = { scale: 1, x: 0, y: 0 }

/** Path key for the selected node — entity path minus `depth` levels. */
export function selectedPathKey(selection: Selection): string {
  const len = selection.path.length - selection.depth
  if (len <= 0) {
    return ""
  }
  return selection.path.slice(0, len).join(".")
}

/** CSS translate string for `transform`. Caller applies the size multiplier
 *  separately via `width`/`height`. */
export function transformToCss(t: ViewportTransform) {
  return `translate(${t.x}px, ${t.y}px)`
}

/** Axis-aligned rect in canvas-local coordinates. Coordinates are in CSS
 *  pixels of the un-zoomed canvas. */
export type Rect = { x: number; y: number; width: number; height: number }

/** A HUD's bounding rect plus its long-axis orientation (see
 *  `HudOrientation` in types.ts). The orientation drives handle-collision
 *  policy: when a handle's escape axis matches the HUD's long axis,
 *  extending past the HUD can't clear the collision — we zoom-to-fit
 *  instead. */
export interface HudRect extends Rect {
  orientation: HudOrientation
}

/** A directional handle's escape axis. Top/bottom handles escape by
 *  growing along the vertical axis; left/right handles along the
 *  horizontal axis. */
function handleAxis(direction: Direction): HudOrientation {
  return direction === "top" || direction === "bottom" ? "vertical" : "horizontal"
}

/**
 * Compute a frame's rect from the layout tree and canvas dimensions.
 *
 * Mirrors the CSS flex layout: every container is `display: flex` with
 * children at `flex: 1`, tiling edge-to-edge — no gap, no padding (see
 * ADR-0001). Pure function — no DOM reads.
 */
export function frameRect(
  layout: Node,
  path: number[],
  canvas: { width: number; height: number },
): Rect {
  let rect: Rect = { x: 0, y: 0, width: canvas.width, height: canvas.height }
  let current: Node = layout
  for (const childIndex of path) {
    if (current.type !== "container") {
      break
    }
    const childCount = current.children.length
    if (current.direction === "horizontal") {
      const childWidth = rect.width / childCount
      rect = {
        x: rect.x + childIndex * childWidth,
        y: rect.y,
        width: childWidth,
        height: rect.height,
      }
    } else {
      const childHeight = rect.height / childCount
      rect = {
        x: rect.x,
        y: rect.y + childIndex * childHeight,
        width: rect.width,
        height: childHeight,
      }
    }
    current = current.children[childIndex]
  }
  return rect
}

/** A rendered leaf entity in canvas-local coordinates. `path` is the
 *  full path to the leaf; `color` is its stable per-entity rgb.
 *  Returned by `layoutFrames` and consumed by both the WebGL renderer
 *  and the JS click hit-test. */
export interface LeafFrame {
  id: string
  path: number[]
  rect: Rect
  color: Rgb
}

/** Walk the layout tree once at the given canvas dims and produce:
 *
 *  - `leaves`: every Entity with its rect and color, in tree-traversal
 *    order. Siblings are non-overlapping (flex tiling), so click
 *    hit-test order doesn't matter.
 *  - `selectedRect`: the rect of the node at `selection.path[..-depth]`
 *    if a selection exists, else null. May be a container, not just an
 *    entity. Used by the handle overlay.
 *
 *  Pure function — no DOM reads. Caller passes scaled canvas dims for
 *  the desired output (e.g. `canvas.width * scale` to render at zoom).
 *  Layout tiles edge-to-edge — no gap, no padding (see ADR-0001).
 */
export function layoutFrames(
  layout: Node,
  canvas: { width: number; height: number },
  selection: Selection | null = null,
): { leaves: LeafFrame[]; selectedRect: Rect | null } {
  const leaves: LeafFrame[] = []
  let selectedRect: Rect | null = null

  const targetedPath =
    selection === null ? null : selection.path.slice(0, selection.path.length - selection.depth)

  function walk(node: Node, path: number[], rect: Rect) {
    if (targetedPath !== null && pathEquals(path, targetedPath)) {
      selectedRect = rect
    }
    if (node.type === "entity") {
      // Snapshot the color tuple — node.color sits inside the Solid
      // store and would otherwise pass a proxied array reference into
      // the renderer, where reads of leaf.color[0..2] inside the
      // layout-effect's apply trip STRICT_READ_UNTRACKED.
      leaves.push({
        id: node.id,
        path: path.slice(),
        rect,
        color: [node.color[0], node.color[1], node.color[2]],
      })
      return
    }
    const childCount = node.children.length
    if (node.direction === "horizontal") {
      const childWidth = rect.width / childCount
      for (let index = 0; index < childCount; index++) {
        const childRect: Rect = {
          x: rect.x + index * childWidth,
          y: rect.y,
          width: childWidth,
          height: rect.height,
        }
        path.push(index)
        walk(node.children[index], path, childRect)
        path.pop()
      }
    } else {
      const childHeight = rect.height / childCount
      for (let index = 0; index < childCount; index++) {
        const childRect: Rect = {
          x: rect.x,
          y: rect.y + index * childHeight,
          width: rect.width,
          height: childHeight,
        }
        path.push(index)
        walk(node.children[index], path, childRect)
        path.pop()
      }
    }
  }

  walk(layout, [], { x: 0, y: 0, width: canvas.width, height: canvas.height })
  return { leaves, selectedRect }
}

/** Apply scale + translation to a rect. The scale multiplies width/height
 *  and offsets x/y; the translation is added on top in canvas coords. */
export function applyTransform(
  rect: Rect,
  scale: number,
  translation: { x: number; y: number },
): Rect {
  return {
    x: rect.x * scale + translation.x,
    y: rect.y * scale + translation.y,
    width: rect.width * scale,
    height: rect.height * scale,
  }
}

/** Compute each handle's natural rect (in canvas-relative coords) given
 *  the frame's rect. Mirrors the CSS positioning of ArrowNotch:
 *  top/bottom centered horizontally on the respective edge; left/right
 *  rotated 90° so dimensions swap. */
export function handleRects(frame: Rect): Record<Direction, Rect> {
  const centerX = frame.x + frame.width / 2
  const centerY = frame.y + frame.height / 2
  return {
    top: { x: centerX - HANDLE_W / 2, y: frame.y, width: HANDLE_W, height: HANDLE_H },
    bottom: {
      x: centerX - HANDLE_W / 2,
      y: frame.y + frame.height - HANDLE_H,
      width: HANDLE_W,
      height: HANDLE_H,
    },
    left: { x: frame.x, y: centerY - HANDLE_W / 2, width: HANDLE_H, height: HANDLE_W },
    right: {
      x: frame.x + frame.width - HANDLE_H,
      y: centerY - HANDLE_W / 2,
      width: HANDLE_H,
      height: HANDLE_W,
    },
  }
}

function rectsOverlap(first: Rect, second: Rect): boolean {
  return (
    first.x < second.x + second.width &&
    second.x < first.x + first.width &&
    first.y < second.y + second.height &&
    second.y < first.y + first.height
  )
}

/** Per-direction extend amount (px) for a frame's handle notches against
 *  HUDs. For each handle, finds the maximum overlap with any HUD on that
 *  handle's outward side; that distance is how far the notch needs to
 *  grow to push its visible portion past the HUD.
 *
 *  HUDs whose long axis matches the handle's escape axis are skipped:
 *  extending can't clear a collinear HUD (the handle would have to grow
 *  past the HUD's full length), so the policy is to zoom-to-fit instead
 *  — see `hasUnescapableHudCollision`. */
export function computeExtends(frame: Rect, hudRects: HudRect[]): Record<Direction, number> {
  const handles = handleRects(frame)
  const extend: Record<Direction, number> = { top: 0, bottom: 0, left: 0, right: 0 }
  for (const hud of hudRects) {
    for (const direction of ["top", "bottom", "left", "right"] as Direction[]) {
      if (hud.orientation === handleAxis(direction)) {
        continue
      }
      const handle = handles[direction]
      if (!rectsOverlap(handle, hud)) {
        continue
      }
      let amount = 0
      switch (direction) {
        case "top":
          amount = hud.y + hud.height - handle.y
          break
        case "bottom":
          amount = handle.y + handle.height - hud.y
          break
        case "left":
          amount = hud.x + hud.width - handle.x
          break
        case "right":
          amount = handle.x + handle.width - hud.x
          break
      }
      if (amount > extend[direction]) {
        extend[direction] = amount
      }
    }
  }
  return extend
}

/** True iff any handle overlaps a HUD whose long axis matches the
 *  handle's escape axis. Such collisions can't be resolved by extending
 *  the notch (the handle would need to grow past the HUD's whole length)
 *  — the caller responds by zooming the frame to fit so handles lay out
 *  away from the HUDs entirely. */
export function hasUnescapableHudCollision(frame: Rect, hudRects: HudRect[]): boolean {
  const handles = handleRects(frame)
  for (const hud of hudRects) {
    for (const direction of ["top", "bottom", "left", "right"] as Direction[]) {
      if (hud.orientation !== handleAxis(direction)) {
        continue
      }
      if (rectsOverlap(handles[direction], hud)) {
        return true
      }
    }
  }
  return false
}

/** Per-direction stick amount (px) — how far to pull each handle inward
 *  to keep it visible inside the canvas viewport. Non-zero when the frame
 *  extends past the canvas edge entirely. */
export function computeSticks(
  rect: Rect,
  canvas: { width: number; height: number },
): Record<Direction, number> {
  return {
    top: Math.max(0, -rect.y),
    bottom: Math.max(0, rect.y + rect.height - canvas.height),
    left: Math.max(0, -rect.x),
    right: Math.max(0, rect.x + rect.width - canvas.width),
  }
}
