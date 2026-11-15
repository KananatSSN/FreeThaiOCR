import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

// The donation QR is the maintainer's own file in private/ (gitignored).
const privateDir = path.join(import.meta.dirname, '..', '..', 'private')
const hasQr = existsSync(privateDir) && readdirSync(privateDir).some((f) => /^promptpay[-_]?qr\./i.test(f))

test('support wheel: links and the donation QR', async ({ page }, info) => {
  await page.goto('/?lng=th')
  const fab = page.getByRole('button', { name: 'สนับสนุนและลิงก์' })
  await expect(fab).toHaveAttribute('aria-expanded', 'false')
  await fab.click()
  await expect(page.getByRole('button', { name: 'ปิด' })).toHaveAttribute('aria-expanded', 'true')

  const model = page.getByRole('link', { name: 'โมเดล OpenThai บน Hugging Face' })
  await expect(model).toHaveAttribute('href', 'https://huggingface.co/iapp/OpenThai2.0-OCR-Text')
  await expect(model).toHaveAttribute('target', '_blank')
  // No VITE_REPO_URL configured: the GitHub item stays hidden rather than linking nowhere.
  if (!process.env.VITE_REPO_URL) await expect(page.getByRole('link', { name: 'ซอร์สโค้ดบน GitHub' })).toHaveCount(0)
  await expect(page.getByRole('tooltip').first()).toBeVisible()
  await page.waitForTimeout(300)
  await page.screenshot({ path: `test-results/fab-${info.project.name}.png` })

  // Escape closes the wheel.
  await page.keyboard.press('Escape')
  await expect(fab).toHaveAttribute('aria-expanded', 'false')

  test.skip(!hasQr, 'no private/promptpay_qr.* on this machine')
  await fab.click()
  await page.getByRole('button', { name: 'สนับสนุนผู้พัฒนา' }).click()
  const dialog = page.getByRole('dialog')
  const img = dialog.getByRole('img', { name: /พร้อมเพย์/ })
  await expect(img).toBeVisible()
  expect(await img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true)
  await expect(dialog.getByRole('link', { name: 'บันทึกรูป QR' })).toHaveAttribute('download', 'ThaiOCR-PromptPay.jpg')
  await page.screenshot({ path: `test-results/donate-${info.project.name}.png` })
})
