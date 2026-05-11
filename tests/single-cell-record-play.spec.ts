import { expect, test } from "@playwright/test"
import { mockGetUserMedia } from "./helpers"

// blobToClip occasionally hangs in headless Chromium when this test
// runs late in the suite (mediabunny demux + repeated page navigations).
// Tried BlobSource useStreamReader: false (1.44.0+) — didn't help.
// Retries cover the flake until we have a more stable approach (e.g.
// programmatic clip injection bypassing MediaRecorder entirely).
test.describe.configure({ retries: 2 })

test("M1: record into the initial cell, then play back", async ({ page }) => {
  await mockGetUserMedia(page)
  await page.goto("/")
  // Initial layout: single entity. `selectedCellId` falls back to root,
  // so Record is valid immediately without an explicit selection.

  await page.locator('[data-action="record-start"]').click()
  // Wait for preview to be active.
  await page.waitForFunction(() => window.__appContext?.preview.activeCellId() !== null)
  // Let the recorder capture ~700ms of fake stream.
  await page.waitForTimeout(700)
  await page.locator('[data-action="record-stop"]').click()
  await page.waitForFunction(
    () => Object.keys(window.__appContext?.clips.clips ?? {}).length === 1,
    { timeout: 10_000 },
  )

  const result = await page.evaluate(() => {
    const root = window.__appContext?.app.layout
    const rootId = root?.type === "entity" ? root.id : null
    const clipIds = Object.keys(window.__appContext?.clips.clips ?? {})
    return { rootId, clipIds }
  })
  expect(result.rootId).not.toBeNull()
  expect(result.clipIds).toEqual([result.rootId])

  await page.locator('[data-action="play"]').click()
  await page.waitForFunction(
    () => window.__appContext?.transport.state() === "playing",
    { timeout: 5000 },
  )
})
