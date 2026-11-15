import path from 'node:path'
import { expect, test } from '@playwright/test'

test('mobile: OCR result opens in a drawer', async ({ page }) => {
  await page.goto('/?lng=th')
  await expect(page.getByRole('button', { name: 'ถ่ายรูป' })).toBeVisible()
  await page.locator('input[type=file]').first().setInputFiles(path.join(import.meta.dirname, '..', 'fixtures', 'dark.png'))
  await page.getByRole('button', { name: /OCR หน้านี้/ }).click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.locator('textarea').first()).toHaveValue(/โปรโมชันพิเศษสำหรับสมาชิก/)
  await page.screenshot({ path: 'test-results/mobile.png' })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})

test('mobile: folder files open in a left drawer', async ({ page }) => {
  await page.goto('/?lng=en')
  await page.getByTestId('pick-folder').first().setInputFiles(path.join(import.meta.dirname, '..', 'fixtures', 'batch'))
  await page.getByRole('button', { name: 'Files', exact: true }).click()
  const drawer = page.getByRole('dialog')
  await expect(drawer.getByText('scan-10.pdf')).toBeVisible()
  await page.waitForTimeout(600) // let the slide-in finish for the screenshot
  await page.screenshot({ path: 'test-results/mobile-files.png' })
  await drawer.getByRole('button', { name: /scan-10\.pdf \d+\/\d+/ }).click()
  await expect(drawer).toBeHidden()
  await page.getByRole('button', { name: 'OCR page' }).click()
  await expect(page.getByRole('dialog').locator('textarea').first()).toHaveValue(/โปรโมชันพิเศษสำหรับสมาชิก/)
})
