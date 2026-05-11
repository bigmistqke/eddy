import { expect, mockGetUserMedia, test } from "./helpers"

test("camera-loading overlay shows while getUserMedia is in flight", async ({ page }) => {
  // Slow gUM by 1s so we can observe the loader at rest.
  await mockGetUserMedia(page, { delayMs: 1000 })
  await page.goto("/")
  // Initial selection arms the preview → stream() is read in Main's
  // trigger effect → isPending(stream) is true → loader appears.
  await expect(page.locator('[data-testid="camera-loader"]')).toBeVisible({ timeout: 500 })
  // Once gUM resolves, the loader goes away.
  await expect(page.locator('[data-testid="camera-loader"]')).toBeHidden({ timeout: 5000 })
})

test("camera-loading overlay positions over the preview target cell", async ({ page }) => {
  await mockGetUserMedia(page, { delayMs: 1000 })
  await page.goto("/")
  const overlay = page.locator('[data-testid="camera-loader"]')
  await overlay.waitFor({ state: "visible", timeout: 500 })
  // Verify positioning via CSS custom properties on the wrapper.
  const positioned = await page.evaluate(() => {
    const wrapper = document.querySelector("[data-canvas-inner]") as HTMLElement | null
    if (wrapper === null) {
      return null
    }
    const styles = wrapper.style
    return {
      x: styles.getPropertyValue("--preview-x"),
      y: styles.getPropertyValue("--preview-y"),
      width: styles.getPropertyValue("--preview-width"),
      height: styles.getPropertyValue("--preview-height"),
    }
  })
  expect(positioned).not.toBeNull()
  expect(positioned!.width).not.toBe("")
  expect(positioned!.height).not.toBe("")
})
