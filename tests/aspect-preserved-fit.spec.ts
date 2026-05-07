import { test } from "@playwright/test"
import { expectFrameRespectsMargin, runActions } from "./helpers"

/**
 * Build a wide-but-short frame via three cascading bottom splits after
 * one right split. Frame is small enough to violate handle-fit minimums
 * (so Rule 1 doesn't short-circuit) and has moderate aspect ratio (so
 * Rule 2's fit-inside applies, not Rule 3's clamp-overflow).
 */
test("Rule 2: small frame zooms aspect-preserved (fit-inside target)", async ({ page }) => {
  await page.goto("/")
  await runActions(
    page,
    `
    [action] {"type":"set-tool","tool":"split"}
    [action] {"type":"tap-frame","path":[]}
    [action] {"type":"add-frame","path":[],"direction":"right","op":"split"}
    [action] {"type":"add-frame","path":[1],"direction":"bottom","op":"split"}
    [action] {"type":"add-frame","path":[1,1],"direction":"bottom","op":"split"}
    [action] {"type":"add-frame","path":[1,1,1],"direction":"bottom","op":"split"}
    `,
  )

  await expectFrameRespectsMargin(page, "fit-inside")
})
