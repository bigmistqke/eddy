import type { Selection } from "./types"
import { VIEWPORT_PADDING } from "./ui-constants"

// Handle dimensions in CSS pixels — derived from frame.module.css and index.css.
// `--hud-height-notch` is 60px; the notch backdrop default width is 100px.
// These give the worst-case footprint of one handle in viewport units.
// If frame.module.css changes, update these to match.
const HANDLE_VIEWPORT_W = 100
const HANDLE_VIEWPORT_H = 60

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
 * scale = max(handleScale, fitScale) where:
 * - handleScale = smallest scale at which two handles (left+right or top+bottom)
 *   no longer overlap on the selected node — derived from HANDLE_VIEWPORT_*.
 * - fitScale = scale that exactly fills the canvas with VIEWPORT_PADDING margin.
 *
 * If handleScale > fitScale (frame is too small to fit handles AND fit canvas),
 * we use handleScale and let the frame overflow the canvas — handle visibility wins.
 *
 * `node` should be queried *while* the layout root is at the previous transform —
 * `offsetWidth/Height` and `offsetLeft/Top` ignore CSS transforms, so this is safe.
 */
export function computeViewportTransform(
  node: HTMLElement,
  layoutRoot: HTMLElement,
  canvasW: number,
  canvasH: number,
): ViewportTransform {
  const { x: nx, y: ny, width: nw, height: nh } = offsetRelativeToRoot(node, layoutRoot)
  if (nw === 0 || nh === 0) return IDENTITY_VIEWPORT

  const handleScale = Math.max((2 * HANDLE_VIEWPORT_W) / nw, (2 * HANDLE_VIEWPORT_H) / nh)
  const fitScale = Math.min(
    (canvasW - 2 * VIEWPORT_PADDING) / nw,
    (canvasH - 2 * VIEWPORT_PADDING) / nh,
  )
  const scale = Math.max(handleScale, fitScale)

  const nodeCenterX = nx + nw / 2
  const nodeCenterY = ny + nh / 2
  const x = canvasW / 2 - nodeCenterX * scale
  const y = canvasH / 2 - nodeCenterY * scale

  return { scale, x, y }
}

export function transformToCss(t: ViewportTransform) {
  return `translate(${t.x}px, ${t.y}px) scale(${t.scale})`
}
