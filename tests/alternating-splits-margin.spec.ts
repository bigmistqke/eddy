import { test } from "@playwright/test"
import { type Action, expectFrameRespectsMargin, runActions } from "./helpers"

/**
 * 11 alternating right/top splits — each split halves one dimension,
 * but aspect ratio stays moderate, so Rule 2 (aspect-preserved
 * fit-inside) should apply.
 */
test("alternating right/top splits: frame fits target with FRAME_PADDING margin", async ({
  page,
}) => {
  await page.goto("/")
  const actions: Action[] = [
    { type: "set-tool", tool: "split" },
    { type: "tap-frame", path: [] },
    { type: "add-frame", path: [], direction: "right", op: "split" },
    { type: "add-frame", path: [1], direction: "top", op: "split" },
    { type: "add-frame", path: [1, 0], direction: "right", op: "split" },
    { type: "add-frame", path: [1, 0, 1], direction: "top", op: "split" },
    { type: "add-frame", path: [1, 0, 1, 0], direction: "right", op: "split" },
    { type: "add-frame", path: [1, 0, 1, 0, 1], direction: "top", op: "split" },
    { type: "add-frame", path: [1, 0, 1, 0, 1, 0], direction: "right", op: "split" },
    { type: "add-frame", path: [1, 0, 1, 0, 1, 0, 1], direction: "top", op: "split" },
    { type: "add-frame", path: [1, 0, 1, 0, 1, 0, 1, 0], direction: "right", op: "split" },
    { type: "add-frame", path: [1, 0, 1, 0, 1, 0, 1, 0, 1], direction: "top", op: "split" },
    { type: "add-frame", path: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0], direction: "right", op: "split" },
    { type: "add-frame", path: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1], direction: "top", op: "split" },
  ]
  await runActions(page, actions)
  await expectFrameRespectsMargin(page, "fit-inside")
})

/**
 * 13 cascading top splits — frame is full-canvas wide × extremely thin
 * (height divided by 2^13). Stress test for the iterative scale solver
 * at very high scale where flex-math non-linearity is most pronounced.
 */
test("very-deep top-split chain: frame still respects margin", async ({ page }) => {
  await page.goto("/")
  const actions: Action[] = [
    { type: "set-tool", tool: "split" },
    { type: "tap-frame", path: [] },
    { type: "add-frame", path: [], direction: "top", op: "split" },
    { type: "add-frame", path: [0], direction: "top", op: "split" },
    { type: "add-frame", path: [0, 0], direction: "top", op: "split" },
    { type: "add-frame", path: [0, 0, 0], direction: "top", op: "split" },
    { type: "add-frame", path: [0, 0, 0, 0], direction: "top", op: "split" },
    { type: "add-frame", path: [0, 0, 0, 0, 0], direction: "top", op: "split" },
    { type: "add-frame", path: [0, 0, 0, 0, 0, 0], direction: "top", op: "split" },
    { type: "add-frame", path: [0, 0, 0, 0, 0, 0, 0], direction: "top", op: "split" },
    { type: "add-frame", path: [0, 0, 0, 0, 0, 0, 0, 0], direction: "top", op: "split" },
    { type: "add-frame", path: [0, 0, 0, 0, 0, 0, 0, 0, 0], direction: "top", op: "split" },
    { type: "add-frame", path: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], direction: "top", op: "split" },
    { type: "add-frame", path: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], direction: "top", op: "split" },
    {
      type: "add-frame",
      path: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      direction: "top",
      op: "split",
    },
  ]
  await runActions(page, actions)
  await expectFrameRespectsMargin(page, "clamp-overflow")
})

/**
 * Six cascading top splits — frame is full canvas wide × very thin,
 * extreme aspect ratio. Expect Rule 3 (clamp-overflow): height fills
 * target, width overflows the canvas.
 */
test("deep top-split chain: frame respects margin (clamp-overflow)", async ({ page }) => {
  await page.goto("/")
  const actions: Action[] = [
    { type: "set-tool", tool: "split" },
    { type: "tap-frame", path: [] },
    { type: "add-frame", path: [], direction: "top", op: "split" },
    { type: "add-frame", path: [0], direction: "top", op: "split" },
    { type: "add-frame", path: [0, 0], direction: "top", op: "split" },
    { type: "add-frame", path: [0, 0, 0], direction: "top", op: "split" },
    { type: "add-frame", path: [0, 0, 0, 0], direction: "top", op: "split" },
    { type: "add-frame", path: [0, 0, 0, 0, 0], direction: "top", op: "split" },
  ]
  await runActions(page, actions)
  await expectFrameRespectsMargin(page, "clamp-overflow")
})
