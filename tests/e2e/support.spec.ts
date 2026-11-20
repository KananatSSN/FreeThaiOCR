import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

// The donation QR is the maintainer's own file in private/ (gitignored).
const privateDir = path.join(import.meta.dirname, '..', '..', 'private')
const hasQr = existsSync(privateDir) && readdirSync(privateDir).some((f) => /^promptpay[-_]?qr\./i.test(f))

// The app gets VITE_REPO_URL from .env (or the environment), like Vite does.
const envFile = path.join(import.meta.dirname, '..', '..', '.env')
const env = (name: string) => (process.env[name] ?? (existsSync(envFile) ? new RegExp(`^${name}=(.*)$`, 'm').exec(readFileSync(envFile, 'utf8'))?.[1] : ''))?.trim()
const repoUrl = env('VITE_REPO_URL')
// Links without a scheme get https:// (src/lib/hire.ts), so "dr-kana.com" doesn't become a path on this site.
const abs = (v?: string) => (v && !/^https?:\/\//i.test(v) ? `https://${v.replace(/^\/+/, '')}` : v)
const hire = { email: env('VITE_HIRE_EMAIL'), phone: env('VITE_HIRE_PHONE'), github: abs(env('VITE_HIRE_GITHUB')), website: abs(env('VITE_HIRE_WEBSITE')) }

test('support wheel: links and the donation QR', async ({ page }, info) => {
  await page.goto('/?lng=th')
  const fab = page.getByRole('button', { name: 'สนับสนุนและลิงก์' })
  await expect(fab).toHaveAttribute('aria-expanded', 'false')
  await fab.click()
  await expect(page.getByRole('button', { name: 'ปิด', exact: true })).toHaveAttribute('aria-expanded', 'true')

  const model = page.getByRole('link', { name: 'โมเดล OpenThai บน Hugging Face' })
  await expect(model).toHaveAttribute('href', 'https://huggingface.co/iapp/OpenThai2.1-OCR-Text-20261118')
  await expect(model).toHaveAttribute('target', '_blank')
  // The GitHub item links to the configured repo, and stays hidden (rather than linking nowhere) without one.
  await expect(page.getByRole('link', { name: 'โมเดล AksonOCR-Lite บน Hugging Face' })).toHaveAttribute('href', 'https://huggingface.co/Remtir/AksonOCR-Lite')
  const github = page.getByRole('link', { name: 'ซอร์สโค้ดบน GitHub' })
  if (repoUrl) await expect(github).toHaveAttribute('href', repoUrl)
  else await expect(github).toHaveCount(0)
  // Labels show beside each item, evenly spaced: same gap between items, right edges aligned.
  await expect(model.getByText('โมเดล OpenThai บน Hugging Face')).toBeVisible()
  await page.waitForTimeout(700) // let the spring settle
  const rows = await page.locator('a[aria-label], button[aria-label]').filter({ has: page.locator('[data-fab-label]') }).evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect()
      const l = e.querySelector('[data-fab-label]')!.getBoundingClientRect()
      return { cy: r.top + r.height / 2, labelRight: l.right, labelCy: l.top + l.height / 2, left: r.left }
    }),
  )
  expect(rows.length).toBeGreaterThanOrEqual(2)
  for (let k = 1; k < rows.length; k++) expect(rows[k].cy - rows[k - 1].cy).toBeCloseTo(rows[1].cy - rows[0].cy, 0)
  for (const r of rows) {
    expect(r.labelCy).toBeCloseTo(r.cy, 0)
    expect(r.left - r.labelRight).toBeCloseTo(12, 0)
    expect(r.labelRight).toBeLessThanOrEqual(page.viewportSize()!.width)
  }
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

test('support wheel: the open-to-work card', async ({ page }) => {
  await page.goto('/?lng=en')
  await page.getByRole('button', { name: 'Support & links' }).click()
  const item = page.getByRole('button', { name: "I'm open to work" })
  // Hidden (rather than an empty card) when no contact details are configured.
  if (!Object.values(hire).some(Boolean)) return await expect(page.getByLabel("I'm open to work")).toHaveCount(0)
  // Only a website: the item links straight to it, no card.
  if (hire.website && !hire.email && !hire.phone && !hire.github) {
    const direct = page.getByRole('link', { name: "I'm open to work" })
    await expect(direct).toHaveAttribute('href', hire.website)
    return await expect(direct).toHaveAttribute('target', '_blank')
  }
  await item.click()
  const dialog = page.getByRole('dialog', { name: "I'm open to work" })
  await expect(dialog).toBeVisible()
  const link = (name: string) => dialog.getByRole('link', { name: new RegExp(`^${name}`) })
  if (hire.email) await expect(link('Email')).toHaveAttribute('href', `mailto:${hire.email}`)
  if (hire.phone) await expect(link('Phone')).toHaveAttribute('href', `tel:${hire.phone.replace(/[^\d+]/g, '')}`)
  if (hire.github) await expect(link('GitHub')).toHaveAttribute('href', hire.github)
  if (hire.website) await expect(link('Website')).toHaveAttribute('href', hire.website)
  for (const [key, value] of Object.entries(hire)) if (!value) await expect(link({ email: 'Email', phone: 'Phone', github: 'GitHub', website: 'Website' }[key]!)).toHaveCount(0)
  await page.screenshot({ path: `test-results/hire-${test.info().project.name}.png` })
})
