import {
  Accessor,
  createEffect,
  createMemo,
  createSignal,
  For,
  onSettled,
  untrack,
  useContext,
} from "solid-js"
import { Notch } from "../components/notch"
import { Context } from "../context"
import type { Container, Node } from "../types"
import { logAction } from "../utils"
import styles from "./breadcrumb.module.css"

const COLOR_CONTAINER = "#1a1a1a"
const COLOR_CELL = "#444"
const COLOR_HIGHLIGHT = "rgb(216, 216, 216)"
const HIGHLIGHT_WIDTH = 2
const GAP = 1

/** Draw the layout tree onto a canvas, outlining the highlighted node. */
function drawNode(
  ctx: CanvasRenderingContext2D,
  node: Node,
  hl: number[],
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const isHl = hl.length === 0
  if (node.type === "entity") {
    ctx.fillStyle = COLOR_CELL
    ctx.fillRect(x, y, w, h)
  } else {
    ctx.fillStyle = COLOR_CONTAINER
    ctx.fillRect(x, y, w, h)
    const n = node.children.length
    if (node.direction === "horizontal") {
      const childW = (w - GAP * (n - 1)) / n
      for (let i = 0; i < n; i++) {
        const childHl = i === hl[0] ? hl.slice(1) : [-1]
        drawNode(ctx, node.children[i], childHl, x + i * (childW + GAP), y, childW, h)
      }
    } else {
      const childH = (h - GAP * (n - 1)) / n
      for (let i = 0; i < n; i++) {
        const childHl = i === hl[0] ? hl.slice(1) : [-1]
        drawNode(ctx, node.children[i], childHl, x, y + i * (childH + GAP), w, childH)
      }
    }
  }
  if (isHl) {
    ctx.strokeStyle = COLOR_HIGHLIGHT
    ctx.lineWidth = HIGHLIGHT_WIDTH
    const inset = HIGHLIGHT_WIDTH / 2
    ctx.strokeRect(x + inset, y + inset, w - HIGHLIGHT_WIDTH, h - HIGHLIGHT_WIDTH)
  }
}

function Minimap(props: { layout: Container; highlightPath: number[]; aspect: number }) {
  let canvasEl!: HTMLCanvasElement
  // Canvas display size is CSS-driven (height: 100%; aspect-ratio). When
  // the breadcrumb's scrollbar appears, the button shrinks vertically and
  // the canvas's CSS height shrinks too — we observe that and resize the
  // bitmap to match. Width is locked at the full-size canvas width on
  // .button itself, so total content width stays stable across scrollbar
  // toggles (no resize-loop).
  const [size, setSize] = createSignal({ w: 0, h: 0 })
  onSettled(() => {
    if (!canvasEl) return
    const ro = new ResizeObserver(() => {
      const r = canvasEl.getBoundingClientRect()
      setSize({ w: r.width, h: r.height })
    })
    ro.observe(canvasEl)
    return () => ro.disconnect()
  })
  createEffect(
    () => [props.layout, props.highlightPath, props.aspect, size()] as const,
    ([layout, highlightPath, aspect, sz]) => {
      if (!canvasEl || sz.w < 1 || sz.h < 1) return
      const dpr = window.devicePixelRatio || 1
      canvasEl.width = sz.w * dpr
      canvasEl.height = sz.h * dpr
      const ctx = canvasEl.getContext("2d")!
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, sz.w, sz.h)
      // Letterbox the layout inside the canvas box — same idea as
      // object-fit: contain, done in the draw call so the bitmap matches
      // the canvas's actual pixel size with no wasted resolution.
      let dw: number, dh: number
      if (sz.w / sz.h > aspect) {
        dh = sz.h
        dw = dh * aspect
      } else {
        dw = sz.w
        dh = dw / aspect
      }
      const dx = (sz.w - dw) / 2
      const dy = (sz.h - dh) / 2
      untrack(() => drawNode(ctx, layout, highlightPath, dx, dy, dw, dh))
    },
  )
  return <canvas ref={canvasEl} style={{ width: "100%", height: "100%", display: "block" }} />
}

export function Breadcrumb(props: { canvasAspect: Accessor<number> }) {
  const context = useContext(Context)!

  // Each segment carries the highlight path from the layout root to the
  // node-in-scope at that segment's depth. `depth` is the value
  // `selection.depth` should take when this segment is tapped.
  const segments = createMemo(() => {
    const { path } = context.app.selection
    const segs: Array<{ highlightPath: number[]; depth: number }> = []

    // Segment 0: root scope — empty highlight path means "this node (root)
    // is highlighted." Visually the entire minimap is outlined.
    segs.push({ highlightPath: [], depth: path.length })

    let current: Node = context.app.layout
    for (let i = 0; i < path.length; i++) {
      if (current.type !== "container") break
      current = current.children[path[i]]
      const depth = path.length - 1 - i
      segs.push({ highlightPath: path.slice(0, i + 1), depth })
    }

    return segs
  })

  // Lock the button's inner width to the canvas's full-size width via a
  // CSS var. Total content width stays constant whether the scrollbar is
  // showing or not — without this, canvas width would track height
  // (aspect-ratio), causing scrollbar-toggle resize loops. Full height
  // (no scrollbar) = hud-height(60) - padding-block-end(--radius=12) -
  // button margin(2*2) - button padding(2*2) = 40.
  const FULL_CANVAS_H = 40
  const buttonWidth = () => `${Math.max(8, Math.round(FULL_CANVAS_H * props.canvasAspect()))}px`

  let contentEl!: HTMLDivElement
  // Scroll the trailing breadcrumb into view whenever the chain grows.
  createEffect(
    () => segments().length,
    n => {
      if (!contentEl || n === 0) return
      contentEl.scrollTo({ left: contentEl.scrollWidth, behavior: "smooth" })
    },
  )

  return (
    <Notch ref={context.setHudElement("breadcrumb")} class={styles.notch} orientation="top">
      <div
        ref={contentEl}
        class={styles.content}
        style={{ "--breadcrumb-button-width": buttonWidth() }}
      >
        <For each={segments()}>
          {(segment, i) => (
            <button
              class={[
                styles.button,
                segment().depth === context.app.selection.depth ? styles.active : "",
              ].join(" ")}
              onClick={() => {
                logAction("tap-breadcrumb", { depth: segment().depth, segmentIndex: i() })
                context.setSelection(selection => {
                  selection.depth = segment().depth
                })
              }}
            >
              <Minimap
                layout={context.app.layout}
                highlightPath={segment().highlightPath}
                aspect={props.canvasAspect()}
              />
            </button>
          )}
        </For>
      </div>
    </Notch>
  )
}
