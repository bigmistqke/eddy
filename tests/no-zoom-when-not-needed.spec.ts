import { expect, test } from "@playwright/test"
import { type Action, runActions } from "./helpers"

/**
 * Single split-right from the root entity. The selected frame [1] is
 * roughly half the canvas — handles fit naturally with no overlap, so the
 * viewport must NOT zoom in. Asserted by reading the canvasInner's
 * inline-style scale (width === viewport width when scale=1).
 */
test("single split-right does not trigger zoom", async ({ page }) => {
  await page.goto("/")

  const actions: Action[] = [
    { type: "set-tool", tool: "split" },
    { type: "tap-frame", path: [] },
    { type: "add-frame", path: [], direction: "right", op: "split" },
  ]
  await runActions(page, actions)

  const viewport = await page.evaluate(() => {
    const inner = document.querySelector<HTMLElement>("[data-canvas-inner='true']")
    const canvas = document.querySelector<HTMLElement>("[data-canvas='true']")
    if (!inner || !canvas) {
      return null
    }
    const innerWidth = parseFloat(inner.style.width) || 0
    const canvasWidth = canvas.getBoundingClientRect().width
    return {
      innerWidth,
      canvasWidth,
      transform: inner.style.transform,
    }
  })

  expect(viewport).not.toBeNull()
  // canvasInner's width tracks canvasWidth × scale. At scale=1 they match
  // (within sub-pixel rounding from the equalsWithin epsilon).
  expect(Math.abs(viewport!.innerWidth - viewport!.canvasWidth)).toBeLessThan(1)
  // No translation either — identity viewport.
  expect(viewport!.transform).toMatch(/translate\(0(?:\.\d+)?(?:px)?,\s*0(?:\.\d+)?(?:px)?\)|^$|none/)
})
