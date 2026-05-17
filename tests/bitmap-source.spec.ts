import { expect, mockGetUserMedia, test } from "./helpers"

test("bitmap-source: clip source latestFrame returns null before seek, populates after", async ({ page }) => {
  await mockGetUserMedia(page)
  await page.goto("/")

  // Record a short clip so the demuxer has real data to feed.
  await page.locator('[data-action="record-start"]').click()
  await page.waitForFunction(() => window.__appContext?.previewTargetCellId() !== null, { timeout: 5000 })
  await page.waitForTimeout(700)
  await page.locator('[data-action="record-stop"]').click()
  await page.waitForFunction(
    () => Object.keys(window.__appContext?.clips.clips ?? {}).length === 1,
    { timeout: 20_000 },
  )

  // Drive the BitmapSource contract directly via the clip.
  const result = await page.evaluate(() => {
    const ctx = window.__appContext
    if (!ctx) {
      return { error: "no context" }
    }
    const ids = Object.keys(ctx.clips.clips)
    const clip = ctx.clips.clips[ids[0]]
    // Reset to defeat any seek the render loop performed after autoplay
    // kicked in post-record-stop.
    clip.video.reset()
    const before = clip.video.latestFrame()
    clip.video.seek(0)
    const after = clip.video.latestFrame()
    return {
      cellId: ids[0],
      beforeIsNull: before === null,
      afterNotNull: after !== null,
      afterIsRgbaShape:
        after !== null &&
        typeof after.width === "number" &&
        typeof after.height === "number" &&
        after.bytes instanceof Uint8Array &&
        after.bytes.byteLength === after.width * after.height * 4,
    }
  })

  expect(result.beforeIsNull).toBe(true)
  expect(result.afterNotNull).toBe(true)
  expect(result.afterIsRgbaShape).toBe(true)
})
