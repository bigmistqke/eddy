import { expect, test } from "@playwright/test"
import { runActions } from "./helpers"

/**
 * Deleting a frame should focus its parent. When the parent collapses
 * into its surviving sibling (had exactly two children), the sibling
 * inherits the parent's path slot — so selecting that path still works
 * as "select the parent context."
 */

test("deleting a leaf focuses the surviving sibling at the parent's path", async ({ page }) => {
  await page.goto("/")

  // Build h[a, h[b, c]] with selection on c at path [1,1].
  await runActions(
    page,
    `
    [action] {"type":"set-tool","tool":"split"}
    [action] {"type":"tap-frame","path":[]}
    [action] {"type":"add-frame","path":[],"direction":"right","op":"split"}
    [action] {"type":"add-frame","path":[1],"direction":"right","op":"split"}
    [action] {"type":"delete"}
    `,
  )

  // After delete, layout collapses to h[a, b]. Selection should be at
  // path [1] (where the parent container used to live, now occupied by
  // the surviving sibling b).
  const result = await page.evaluate(() => {
    // The currently-selected frame is the only one rendering handles.
    const handle = document.querySelector<HTMLElement>("[data-direction='bottom']")
    const selected = handle?.closest<HTMLElement>("[data-path]")
    return selected?.getAttribute("data-path") ?? null
  })

  expect(result).toBe("1")
})

test("deleting the root entity focuses the fresh replacement entity", async ({ page }) => {
  await page.goto("/")

  await runActions(
    page,
    `
    [action] {"type":"set-tool","tool":"split"}
    [action] {"type":"tap-frame","path":[]}
    [action] {"type":"delete"}
    `,
  )

  const result = await page.evaluate(() => {
    const handle = document.querySelector<HTMLElement>("[data-direction='bottom']")
    const selected = handle?.closest<HTMLElement>("[data-path]")
    return selected?.getAttribute("data-path") ?? null
  })

  // Root path renders as data-path=""
  expect(result).toBe("")
})
