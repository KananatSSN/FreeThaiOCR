// Captures real FreeThaiOCR screenshots for the promo video into public/screens/.
// Needs the app's dev server running (cd .. && npm run dev) and Google Chrome.
// Run from promo/:  node scripts/capture.mjs  [baseUrl, default http://localhost:5173]
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const base = process.argv[2] ?? 'http://localhost:5173'
const root = path.resolve(import.meta.dirname, '..', '..')
const fx = (f) => path.join(root, 'tests', 'fixtures', f)
const out = path.resolve(import.meta.dirname, '..', 'public', 'screens')
await mkdir(out, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const shot = (page, name, opts = {}) => page.screenshot({ path: path.join(out, `${name}.png`), ...opts })
// Hide the floating support button: it isn't part of what each scene shows.
const hideFab = (page) => page.addStyleTag({ content: '.fixed.right-4.bottom-4{display:none!important} [data-sonner-toaster]{display:none!important}' })

// --- Phone (1080 px wide) ------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 1080 / 412, isMobile: true, hasTouch: true, colorScheme: 'light' })
  const page = await ctx.newPage()
  await page.goto(`${base}/?lng=th`)
  await hideFab(page)
  await page.waitForTimeout(500)
  await shot(page, 'phone-landing')

  await page.getByTestId('pick-files').first().setInputFiles(fx('th_doc.png'))
  await page.getByRole('button', { name: /OCR หน้านี้/ }).waitFor()
  await page.waitForTimeout(1200) // page image decoded and drawn
  await shot(page, 'phone-doc') // before OCR: no line boxes (the video reveals them)
  await page.getByRole('button', { name: /OCR หน้านี้/ }).click()
  const drawer = page.getByRole('dialog')
  await drawer.locator('textarea').first().waitFor()
  await page.waitForTimeout(700)
  await shot(page, 'phone-results')
  await page.keyboard.press('Escape')
  await drawer.waitFor({ state: 'hidden' })
  await page.waitForTimeout(500)
  await shot(page, 'phone-lines')
  await ctx.close()
}

// --- Desktop (2560 x 1600 px) ----------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, colorScheme: 'light' })
  const page = await ctx.newPage()
  await page.goto(`${base}/?lng=th`)
  await hideFab(page)

  // Box drawing: one box around paragraph 2 of the Thai notice.
  await page.getByTestId('pick-files').first().setInputFiles(fx('th_doc.png'))
  await page.getByRole('button', { name: /OCR หน้านี้/ }).click()
  await page.locator('textarea').first().waitFor()
  await page.getByRole('radio', { name: /วาดกรอบ/ }).click()
  const bb = await page.locator('canvas').last().boundingBox()
  const [W, H] = [1240, 1100]
  const s = Math.min(bb.width / W, bb.height / H) * 0.96
  const at = (x, y) => ({ x: bb.x + (bb.width - W * s) / 2 + x * s, y: bb.y + (bb.height - H * s) / 2 + y * s })
  const a = at(70, 290)
  const b = at(1150, 375)
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 8 })
  await page.mouse.up()
  await page.locator('[data-slot=card] textarea').first().waitFor()
  await page.waitForFunction(() => /ในระหว่าง/.test(document.querySelector('[data-slot=card] textarea')?.value ?? ''))
  await page.waitForTimeout(400)
  await shot(page, 'desktop-box')

  // Multi-file: a folder, all read, sidebar visible.
  await page.goto(`${base}/?lng=th`)
  await hideFab(page)
  await page.getByTestId('pick-folder').first().setInputFiles(fx('batch'))
  await page.getByText('title.png').waitFor()
  await page.getByRole('button', { name: /^OCR ทุกไฟล์ \d+$/ }).click()
  await page.getByRole('button', { name: /อ่านครบทุกไฟล์แล้ว/ }).waitFor({ timeout: 120_000 })
  await page.waitForTimeout(500)
  await shot(page, 'desktop-files')

  // Export menu open (ZIP options visible).
  await page.getByRole('button', { name: /ส่งออก/ }).click()
  await page.getByRole('menuitem').first().waitFor()
  await page.waitForTimeout(300)
  await shot(page, 'desktop-export')
  await ctx.close()
}

await browser.close()
console.log('screens written to', path.relative(process.cwd(), out))
