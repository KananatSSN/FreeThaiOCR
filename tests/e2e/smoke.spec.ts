import path from 'node:path'
import { expect, test } from '@playwright/test'

const fixture = (f: string) => path.join(import.meta.dirname, '..', 'fixtures', f)

test.describe.configure({ mode: 'serial' })

test('isolated, OCRs a page, reads a drawn box', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto('/?lng=en')
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)

  await page.locator('input[type=file]').first().setInputFiles(fixture('th_doc.png'))
  await page.getByRole('button', { name: /OCR page|OCR หน้านี้/ }).click()
  const textarea = page.locator('textarea').first()
  await expect(textarea).toHaveValue(/ประกาศเรื่องการปรับปรุงระบบบริการออนไลน์/)
  await page.screenshot({ path: 'test-results/page-ocr.png' })

  // Draw a box around the second paragraph and check it reads just that.
  await page.getByRole('radio', { name: /Draw box|วาดกรอบ/ }).click()
  const canvas = page.locator('canvas').last()
  const bb = (await canvas.boundingBox())!
  // The viewer fits the page (1240x1100 px) into the canvas with a 4% margin;
  // map page px -> screen px through that transform.
  const [W, H] = [1240, 1100]
  const s = Math.min(bb.width / W, bb.height / H) * 0.96
  const fit = { scale: s, x: (bb.width - W * s) / 2, y: (bb.height - H * s) / 2 }
  const toScreen = (x: number, y: number) => ({ x: bb.x + fit.x + x * fit.scale, y: bb.y + fit.y + y * fit.scale })
  const a = toScreen(70, 290)
  const b = toScreen(1150, 375)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 8 })
  await page.mouse.up()
  const boxText = page.locator('[data-slot=card] textarea').first()
  await expect(boxText).toHaveValue(/ในระหว่างการปรับปรุง/)
  await expect(boxText).not.toHaveValue(/ประกาศเรื่อง/)
  await page.screenshot({ path: 'test-results/box-ocr.png' })
  expect(errors.filter((e) => !/favicon/.test(e))).toEqual([])
})
