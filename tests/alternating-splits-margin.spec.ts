import { test } from "@playwright/test"
import { expectFrameRespectsMargin, runActions } from "./helpers"

/**
 * 11 alternating right/top splits — each split halves one dimension,
 * but aspect ratio stays moderate, so Rule 2 (aspect-preserved
 * fit-inside) should apply.
 */
test("alternating right/top splits: frame fits target with FRAME_PADDING margin", async ({
  page,
}) => {
  await page.goto("/")
  await runActions(
    page,
    `
    [action] {"type":"set-tool","tool":"split"}
    [action] {"type":"tap-frame","path":[]}
    [action] {"type":"add-frame","path":[],"direction":"right","op":"split"}
    [action] {"type":"add-frame","path":[1],"direction":"top","op":"split"}
    [action] {"type":"add-frame","path":[1,0],"direction":"right","op":"split"}
    [action] {"type":"add-frame","path":[1,0,1],"direction":"top","op":"split"}
    [action] {"type":"add-frame","path":[1,0,1,0],"direction":"right","op":"split"}
    [action] {"type":"add-frame","path":[1,0,1,0,1],"direction":"top","op":"split"}
    [action] {"type":"add-frame","path":[1,0,1,0,1,0],"direction":"right","op":"split"}
    [action] {"type":"add-frame","path":[1,0,1,0,1,0,1],"direction":"top","op":"split"}
    [action] {"type":"add-frame","path":[1,0,1,0,1,0,1,0],"direction":"right","op":"split"}
    [action] {"type":"add-frame","path":[1,0,1,0,1,0,1,0,1],"direction":"top","op":"split"}
    [action] {"type":"add-frame","path":[1,0,1,0,1,0,1,0,1,0],"direction":"right","op":"split"}
    [action] {"type":"add-frame","path":[1,0,1,0,1,0,1,0,1,0,1],"direction":"top","op":"split"}
    `,
  )

  await expectFrameRespectsMargin(page, "fit-inside")
})
