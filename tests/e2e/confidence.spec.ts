import path from 'node:path'
import { expect, test } from '@playwright/test'

const fixture = (f: string) => path.join(import.meta.dirname, '..', 'fixtures', f)

test('word boxes coloured by confidence: score on hover, toggle remembered', async ({ page }) => {
  await page.goto('/?lng=en')
  await page.locator('input[type=file]').first().setInputFiles(fixture('th_doc.png'))
  await expect(page.locator('textarea').first()).toHaveValue(/ประกาศเรื่องการปรับปรุงระบบบริการออนไลน์/)

  const toggle = page.getByRole('button', { name: 'Colour words by confidence' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'true') // on by default
  const legend = page.getByTestId('confidence-legend')
  await expect(legend).toContainText('≥ 95%')

  // Sweep the pointer over the page until it lands on a word: its text and score show.
  const box = (await page.locator('canvas').first().boundingBox())!
  const tip = page.getByTestId('confidence-tip')
  let found = false
  for (let y = 0.15; y < 0.9 && !found; y += 0.03) {
    for (let x = 0.2; x < 0.8 && !found; x += 0.05) {
      await page.mouse.move(box.x + box.width * x, box.y + box.height * y)
      found = await tip.isVisible()
    }
  }
  expect(found).toBe(true)
  await expect(tip).toHaveText(/\d+%$/)

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(legend).toBeHidden()
  await expect(tip).toBeHidden()

  // The choice is remembered.
  await page.reload()
  await page.locator('input[type=file]').first().setInputFiles(fixture('th_doc.png'))
  await expect(page.locator('textarea').first()).toHaveValue(/ประกาศ/)
  await expect(page.getByRole('button', { name: 'Colour words by confidence' })).toHaveAttribute('aria-pressed', 'false')
  await expect(legend).toBeHidden()
})
