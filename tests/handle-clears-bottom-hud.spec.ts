import { expect, test } from "@playwright/test"
import { runActions } from "./helpers"

/**
 * Repro: split-right four times. The selected frame is so narrow at scale=1
 * that fit-to-target must zoom enough to make WIDTH fill the target box;
 * height then overflows the canvas. Stick clamps top/bottom handles to the
 * canvas edges, and extend pushes them past the HUDs there. We assert two
 * things:
 *   1. No two adjacent handles' visible rects overlap.
 *   2. Each handle's visible portion clears every overlapping HUD.
 */
test("deep right-split chain: handles don't overlap each other or HUDs", async ({ page }) => {
  await page.goto("/")

  await runActions(
    page,
    `
    [action] {"type":"set-tool","tool":"split"}
    [action] {"type":"tap-frame","path":[]}
    [action] {"type":"add-frame","path":[],"direction":"right","op":"split"}
    [action] {"type":"add-frame","path":[1],"direction":"right","op":"split"}
    [action] {"type":"add-frame","path":[1,1],"direction":"right","op":"split"}
    [action] {"type":"add-frame","path":[1,1,1],"direction":"right","op":"split"}
    `,
  )

  const dump = await page.evaluate(() => {
    const rect = (el: Element | null | undefined) => {
      if (!el) {
        return null
      }
      const r = el.getBoundingClientRect()
      return { x: r.left, y: r.top, w: r.width, h: r.height }
    }
    // The .notch wrapper has zero in-flow size (it's a positioning anchor);
    // the visible/hit area is its first child .notchBackdrop, which carries
    // the real width/height after rotation.
    const handles: Record<string, { x: number; y: number; w: number; h: number } | null> = {}
    for (const direction of ["top", "bottom", "left", "right"]) {
      const wrapper = document.querySelector(`[data-direction='${direction}']`)
      handles[direction] = rect(wrapper?.firstElementChild)
    }
    // Resolve actual HUD elements by walking up from a known button —
    // matching `[class*='hudBottom']` directly is unsafe because directional
    // handle notches share the same class.
    const huds: Record<string, { x: number; y: number; w: number; h: number } | null> = {
      mainBottom: rect(
        document.querySelector("[data-action='set-tool-append']")?.closest("[class*='_notch_']"),
      ),
      contextualRight: rect(
        document.querySelector("[data-action='deselect']")?.closest("[class*='_notch_']"),
      ),
      // Breadcrumb is the only top-oriented HUD notch.
      breadcrumbTop: rect(document.querySelector("[class*='hudTop']")),
    }
    return {
      window: { w: window.innerWidth, h: window.innerHeight },
      canvas: rect(document.querySelector("[data-canvas='true']")),
      handles,
      huds,
    }
  })

  // Sanity: window/canvas match the configured Playwright viewport so the
  // assertion below is meaningful (1280×800 per playwright.config.ts).
  expect(dump.window).toEqual({ w: 1280, h: 800 })

  type Rect = { x: number; y: number; w: number; h: number }
  function overlaps(a: Rect, b: Rect): boolean {
    return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  }

  // Each handle must exist with positive hit area.
  for (const [direction, r] of Object.entries(dump.handles)) {
    expect(r, `${direction} handle missing`).not.toBeNull()
    expect(r!.w, `${direction} handle width`).toBeGreaterThan(0)
    expect(r!.h, `${direction} handle height`).toBeGreaterThan(0)
  }

  // No two handles' visible rects may overlap each other.
  const handleList = Object.entries(dump.handles).map(([direction, r]) => ({ direction, rect: r! }))
  for (let i = 0; i < handleList.length; i++) {
    for (let j = i + 1; j < handleList.length; j++) {
      const a = handleList[i]
      const b = handleList[j]
      expect(
        overlaps(a.rect, b.rect),
        `${a.direction} handle overlaps ${b.direction} handle: ${JSON.stringify({ a: a.rect, b: b.rect })}`,
      ).toBe(false)
    }
  }

  // Each handle's "tip" (the canvas-center-facing edge) must sit past the
  // HUD's frame-side edge — i.e. there must be a visible strip of handle
  // between the HUD and the canvas interior. computeExtends grows the
  // notch so this strip is always present even when a HUD covers the
  // handle's anchor region.
  function tipPastHud(handleRect: Rect, hudRect: Rect, direction: string): boolean {
    switch (direction) {
      case "top":
        // Top handle's tip is its bottom edge; should be below HUD's bottom.
        return handleRect.y + handleRect.h > hudRect.y + hudRect.h
      case "bottom":
        // Bottom handle's tip is its top edge; should be above HUD's top.
        return handleRect.y < hudRect.y
      case "left":
        return handleRect.x + handleRect.w > hudRect.x + hudRect.w
      case "right":
        return handleRect.x < hudRect.x
      default:
        return true
    }
  }
  for (const [hudName, hudRect] of Object.entries(dump.huds)) {
    if (!hudRect) {
      continue
    }
    for (const handle of handleList) {
      if (!overlaps(handle.rect, hudRect)) {
        continue
      }
      expect(
        tipPastHud(handle.rect, hudRect, handle.direction),
        `${handle.direction} handle is entirely behind ${hudName} HUD: ${JSON.stringify({ handle: handle.rect, hud: hudRect })}`,
      ).toBe(true)
    }
  }
})
