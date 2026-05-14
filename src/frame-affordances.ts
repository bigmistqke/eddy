import { HANDLE_H, HANDLE_W } from "./constants"
import type { Node } from "./types"
import type { SelectedHandlesState } from "./types"
import {
  computeExtends,
  computeSticks,
  frameRect,
  hasUnescapableHudCollision,
  IDENTITY_VIEWPORT,
  type HudRect,
  type Rect,
  type ViewportTransform,
} from "./viewport"

const ZERO_BY_DIRECTION = { top: 0, bottom: 0, left: 0, right: 0 } as const

/** What the canvas needs to paint a selected frame: where the viewport
 *  sits, and the per-direction extend/stick for its handles. */
export interface FrameAffordances {
  viewport: ViewportTransform
  handles: SelectedHandlesState
}

const IDENTITY_AFFORDANCES: FrameAffordances = {
  viewport: IDENTITY_VIEWPORT,
  handles: { extend: ZERO_BY_DIRECTION, stick: ZERO_BY_DIRECTION },
}

/** Minimum dimension required for both same-axis and cross-pair handle
 *  pairs to fit non-overlapping on a single axis. */
const MIN_HANDLE_DIM = HANDLE_W + 2 * HANDLE_H

/** Closed-form fit-scale (ADR-0001 — layout is linearly scalable). */
function findFitScale(
  layout: Node,
  path: number[],
  canvas: { width: number; height: number },
): number {
  if (canvas.width <= 0 || canvas.height <= 0) {
    return 1
  }
  const rect = frameRect(layout, path, canvas)
  if (rect.width <= 0 || rect.height <= 0) {
    return 1
  }
  const inside = Math.min(canvas.width / rect.width, canvas.height / rect.height)
  if (inside * Math.min(rect.width, rect.height) >= MIN_HANDLE_DIM) {
    return inside
  }
  return Math.max(canvas.width / rect.width, canvas.height / rect.height)
}

/**
 * The single pure decision for a selected frame: viewport transform plus
 * the per-direction extend/stick for its handles.
 *
 * `path === null` → identity affordances (no frame to compute for — the
 * canvas passes null in song mode, where app policy says "don't zoom").
 * The module itself knows nothing about tools or app modes.
 *
 * Pure function — no DOM reads, no signals. `hudRects` and `canvas` are
 * supplied by the caller (canvas-relative coords).
 */
export function computeFrameAffordances(
  layout: Node,
  path: number[] | null,
  canvas: { width: number; height: number },
  hudRects: HudRect[],
): FrameAffordances {
  if (path === null) {
    return IDENTITY_AFFORDANCES
  }

  const baseRect = frameRect(layout, path, canvas)
  if (baseRect.width === 0 || baseRect.height === 0) {
    return IDENTITY_AFFORDANCES
  }

  // Natural-fit short-circuit: at scale 1, do all 4 handles fit
  // non-overlapping after the natural extends pushed by HUDs?
  const axisCollision = hasUnescapableHudCollision(baseRect, hudRects)
  const naturalExt = computeExtends(baseRect, hudRects)
  const sameAxisH = 2 * HANDLE_H
  const crossPair = HANDLE_W + 2 * HANDLE_H
  const verticalFits = baseRect.height >= sameAxisH + naturalExt.top + naturalExt.bottom
  const horizontalFits = baseRect.width >= sameAxisH + naturalExt.left + naturalExt.right
  const crossWidthFits = baseRect.width >= crossPair
  const crossHeightFits = baseRect.height >= crossPair

  let viewport: ViewportTransform
  if (!axisCollision && verticalFits && horizontalFits && crossWidthFits && crossHeightFits) {
    viewport = IDENTITY_VIEWPORT
  } else {
    const scale = findFitScale(layout, path, canvas)
    const x = canvas.width / 2 - (baseRect.x + baseRect.width / 2) * scale
    const y = canvas.height / 2 - (baseRect.y + baseRect.height / 2) * scale
    viewport = { scale, x, y }
  }

  // Post-transform handle geometry: stick (canvas-edge clamp) first,
  // then extend (HUD clearance) on the resulting stuck rect.
  const postRect: Rect = {
    x: baseRect.x * viewport.scale + viewport.x,
    y: baseRect.y * viewport.scale + viewport.y,
    width: baseRect.width * viewport.scale,
    height: baseRect.height * viewport.scale,
  }
  const stick = computeSticks(postRect, canvas)
  const stuckRect: Rect = {
    x: postRect.x + stick.left,
    y: postRect.y + stick.top,
    width: postRect.width - stick.left - stick.right,
    height: postRect.height - stick.top - stick.bottom,
  }
  const extend = computeExtends(stuckRect, hudRects)

  return { viewport, handles: { extend, stick } }
}
