import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

// The donation QR is the maintainer's own file in private/ (gitignored).
const privateDir = path.join(import.meta.dirname, '..', '..', 'private')
const hasQr = existsSync(privateDir) && readdirSync(privateDir).some((f) => /^promptpay[-_]?qr\./i.test(f))

// The app gets VITE_REPO_URL from .env (or the environment), like Vite does.
const envFile = path.join(import.meta.dirname, '..', '..', '.env')
const repoUrl = (process.env.VITE_REPO_URL ?? (existsSync(envFile) ? /^VITE_REPO_URL=(.*)$/m.exec(readFileSync(envFile, 'utf8'))?.[1] : ''))?.trim()

test('support wheel: links and the donation QR', async ({ page }, info) => {
  await page.goto('/?lng=th')
  const fab = page.getByRole('button', { name: 'สนับสนุนและลิงก์' })
  await expect(fab).toHaveAttribute('aria-expanded', 'false')
  await fab.click()
  await expect(page.getByRole('button', { name: 'ปิด' })).toHaveAttribute('aria-expanded', 'true')

  const model = page.getByRole('link', { name: 'โมเดล OpenThai บน Hugging Face' })
  await expect(model).toHaveAttribute('href', 'https://huggingface.co/iapp/OpenThai2.1-OCR-Text-20261118')
  await expect(model).toHaveAttribute('target', '_blank')
  // The GitHub item links to the configured repo, and stays hidden (rather than linking nowhere) without one.
  await expect(page.getByRole('link', { name: 'โมเดล AksonOCR-Lite บน Hugging Face' })).toHaveAttribute('href', 'https://huggingface.co/Remtir/AksonOCR-Lite')
  const github = page.getByRole('link', { name: 'ซอร์สโค้ดบน GitHub' })
  if (repoUrl) await expect(github).toHaveAttribute('href', repoUrl)
  else await expect(github).toHaveCount(0)
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
  // Visible can come before decoded: wait for the image to actually load.
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true)
  await expect(dialog.getByRole('link', { name: 'บันทึกรูป QR' })).toHaveAttribute('download', 'FreeThaiOCR-PromptPay.jpg')
  await page.screenshot({ path: `test-results/donate-${info.project.name}.png` })
})
