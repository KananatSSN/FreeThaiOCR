import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const fx = (f: string) => readFileSync(path.join(import.meta.dirname, '..', 'fixtures', f))

// The file sidebar must reflow (truncate names, keep counts and buttons visible)
// when its panel is resized, never spill under the viewer.
test('file sidebar content follows the panel width', async ({ page }) => {
  await page.goto('/?lng=en')
  // Real folders have long names; these must truncate rather than widen the list.
  const longName = 'รายงานการประชุมคณะกรรมการบริหารประจำเดือนพฤศจิกายน-2569-ฉบับแก้ไขครั้งที่-3.pdf'
  await page.getByTestId('pick-files').first().setInputFiles([
    { name: longName, mimeType: 'application/pdf', buffer: fx('sample.pdf') },
    { name: 'Quarterly-maintenance-notice-for-the-document-archive-and-search-service.png', mimeType: 'image/png', buffer: fx('en_doc.png') },
  ])
  await page.getByRole('button', { name: /รายงานการประชุม.*\d+\/\d+/ }).click()
  await expect(page.locator('li img').first()).toBeVisible() // thumbnails of the 3-page PDF
  const panel = page.locator('[data-slot=resizable-panel]').first()
  const handle = page.locator('[data-slot=resizable-handle]').first()

  for (const dx of [-60, 140]) {
    const h = (await handle.boundingBox())!
    await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2)
    await page.mouse.down()
    await page.mouse.move(h.x + h.width / 2 + dx, h.y + h.height / 2, { steps: 6 })
    await page.mouse.up()
    const p = (await panel.boundingBox())!
    // Every row (and its count + remove button) must end inside the panel.
    const overflow = await panel.locator('li > div').evaluateAll((rows, right) => rows.map((r) => Math.round(r.getBoundingClientRect().right - (right as number))), p.x + p.width)
    await page.screenshot({ path: `test-results/sidebar-${p.width.toFixed(0)}.png`, clip: { x: 0, y: 0, width: 560, height: 360 } })
    expect(Math.max(...overflow), `panel ${p.width}px wide`).toBeLessThanOrEqual(0)
    // Counts and remove buttons stay reachable at every width.
    for (const b of await panel.getByRole('button', { name: /^Remove / }).all()) await expect(b).toBeInViewport()
    const thumbs = await panel.locator('li img').evaluateAll((imgs, right) => imgs.map((i) => Math.round(i.getBoundingClientRect().right - (right as number))), p.x + p.width)
    expect(Math.max(...thumbs), 'thumbnails inside the panel').toBeLessThanOrEqual(0)
  }
})
