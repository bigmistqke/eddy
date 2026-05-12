import { test } from "./helpers"
import { type Action, expectHandlesDontOverlap, runActions } from "./helpers"

/**
 * Repro: append cascade — left, top, right, top — four levels deep with
 * the new entity selected at each step. The deepest cell ends up in a
 * narrow container where the four directional handles overlap each
 * other. Captured from a user session — the tap-frame log lines from
 * that session are dropped here since add-frame already selects the
 * newly-created entity.
 */
test("append cascade [left, top, right, top]: handles don't overlap", async ({ page }) => {
  // Mobile-ish portrait viewport — the user-captured overlap reproduces
  // when the deepest cell ends up narrow; on the default 1280×800 desktop
  // viewport there's plenty of room and the four handles separate cleanly.
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto("/")
  const actions: Action[] = [
    { type: "set-tool", tool: "append" },
    { type: "add-frame", path: [], direction: "left", op: "append" },
    { type: "add-frame", path: [0], direction: "top", op: "append" },
    { type: "add-frame", path: [0, 0], direction: "right", op: "append" },
    { type: "add-frame", path: [0, 0, 1], direction: "top", op: "append" },
  ]
  await runActions(page, actions)
  await expectHandlesDontOverlap(page)
})
