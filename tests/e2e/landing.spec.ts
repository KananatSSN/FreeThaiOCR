import { expect, test } from '@playwright/test'

// The landing page fits the screen: nothing to scroll, from small phones to large monitors.
const SIZES: [number, number][] = [
  [1920, 1080],
  [1366, 768],
  [1280, 720],
  [1024, 700],
  [820, 1180],
  [412, 839],
  [390, 844],
  [375, 667],
  [360, 640],
]

for (const lng of ['th', 'en']) {
  test(`landing page fits without scrolling (${lng})`, async ({ page }) => {
    await page.goto(`/?lng=${lng}`)
    for (const [width, height] of SIZES) {
      await page.setViewportSize({ width, height })
      await page.waitForTimeout(50)
      const m = await page.evaluate(() => {
        const main = document.querySelector('main')!
        return { y: main.scrollHeight - main.clientHeight, x: document.documentElement.scrollWidth - innerWidth }
      })
      expect(m, `${width}x${height}`).toEqual({ y: 0, x: 0 })
    }
  })
}
