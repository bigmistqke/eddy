import { test } from "./helpers"
import { type Action, expectHandlesDontOverlap, runActions } from "./helpers"

/**
 * Repro: append-right four times on the root. Layout becomes a
 * horizontal row of five tall-narrow cells; the deepest selection
 * is at [4]. Reported overlap is between one of the directional
 * handles and the contextual tool-bar (middle-right HUD).
 *
 * Captured at 957×779.
 */
test("append-right ×4: handles don't overlap the contextual HUD", async ({ page }) => {
  await page.setViewportSize({ width: 957, height: 779 })
  await page.goto("/")
  const actions: Action[] = [
    { type: "set-tool", tool: "append" },
    { type: "add-frame", path: [], direction: "right", op: "append" },
    { type: "add-frame", path: [1], direction: "right", op: "append" },
    { type: "add-frame", path: [2], direction: "right", op: "append" },
    { type: "add-frame", path: [3], direction: "right", op: "append" },
  ]
  await runActions(page, actions)
  await expectHandlesDontOverlap(page)
})
