import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'

const fixture = (f: string) => path.join(import.meta.dirname, '..', 'fixtures', f)
test.describe.configure({ mode: 'serial' })

const aksonText = (page: Page) => page.getByRole('textbox', { name: 'Text read by AksonOCR-Lite' })

async function save(page: Page, item: string) {
  await page.getByRole('button', { name: 'Export' }).click()
  const wait = page.waitForEvent('download')
  await page.getByRole('menuitem', { name: item, exact: true }).click()
  const d = await wait
  const p = test.info().outputPath(d.suggestedFilename())
  await d.saveAs(p)
  return { name: d.suggestedFilename(), body: readFileSync(p, 'utf8') }
}

test('AksonOCR tab: loads on request, reads only the page on screen, exports follow the tab', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto('/?lng=en')
  // sample.pdf: three pages (page 1 born-digital, but OCR'd like the others).
  await page.locator('input[type=file]').first().setInputFiles(fixture('sample.pdf'))
  await expect(page.getByRole('status').filter({ hasText: 'All pages read' })).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: 'Next page' }).click()

  // Nothing downloads until asked.
  await page.getByRole('tab', { name: 'AksonOCR' }).click()
  await page.getByRole('button', { name: 'Load AksonOCR (22 MB)' }).click()
  await expect(aksonText(page)).toHaveValue(/ประกาศเรื่องการปรับปรุงระบบบริการออนไลน์/, { timeout: 120_000 })
  await expect(page.getByText('AksonOCR-Lite', { exact: true })).toBeVisible()

  // Page 3 wasn't read by Akson in the background: it reads when shown.
  await page.getByRole('tab', { name: 'OpenThai' }).click()
  await page.getByRole('button', { name: 'Next page' }).click()
  await page.waitForTimeout(3000)
  await page.getByRole('tab', { name: 'AksonOCR' }).click()
  await expect(page.getByText(/Reading…|Waiting to be read…/)).toBeVisible()
  await expect(aksonText(page)).toHaveValue(/จดหมายข่าวประจำเดือน/, { timeout: 60_000 })

  // Exports use the open tab's engine: page 1, never shown in this tab, is read by Akson for the export.
  const akson = JSON.parse((await save(page, 'JSON with positions (.json)')).body)
  expect(akson.pages.map((p: { engine: string | null }) => p.engine)).toEqual(Array(3).fill('AksonOCR-Lite (fp16)'))
  expect(akson.pages[0].text).toMatch(/ใบแจ้งค่าบริการ/)
  await page.getByRole('tab', { name: 'OpenThai' }).click()
  const openthai = JSON.parse((await save(page, 'JSON with positions (.json)')).body)
  expect(openthai.pages[1].engine).toBe('OpenThai2.1-OCR-Text-20261118')

  // The agreement to download is remembered: after a reload the tab reads straight away.
  await page.reload()
  await page.locator('input[type=file]').first().setInputFiles(fixture('th_doc.png'))
  await page.getByRole('tab', { name: 'AksonOCR' }).click()
  await expect(page.getByRole('button', { name: 'Load AksonOCR (22 MB)' })).toBeHidden()
  await expect(aksonText(page)).toHaveValue(/ประกาศเรื่องการปรับปรุงระบบบริการออนไลน์/, { timeout: 120_000 })
  expect(errors).toEqual([])
})

test('AksonOCR document mode: tables as Markdown, .md and .txt exports', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/?lng=en')
  await page.locator('input[type=file]').first().setInputFiles(fixture('invoice.png'))
  // Each test gets a fresh browser profile: agree to the download again.
  await page.getByRole('tab', { name: 'AksonOCR' }).click()
  await page.getByRole('button', { name: 'Load AksonOCR (22 MB)' }).click()
  await page.getByRole('switch', { name: 'Document mode' }).click()
  await page.getByRole('button', { name: 'Download and use' }).click()
  const text = aksonText(page)
  await expect(text).toHaveValue(/<table>/, { timeout: 180_000 })
  await expect(text).toHaveValue(/## ใบแจ้งหนี้ เลขที่ INV-2569-0412/)
  // Same as the reference: TATR merges the label over two of the five columns.
  await expect(text).toHaveValue(/<td colspan="2">ภาษีมูลค่าเพิ่ม 7%<\/td>/)
  await expect(page.getByText('AksonOCR-Lite · Markdown')).toBeVisible()

  const md = await save(page, 'Markdown (.md)')
  expect(md.name).toBe('invoice.md')
  expect(md.body).toContain('<th>รายการ</th>')
  const txt = await save(page, 'Text file (.txt)')
  expect(txt.body).toContain('ลำดับ\tรายการ\tจำนวน')
  expect(txt.body).not.toContain('<td')

  // Switching document mode off re-reads the page as plain text.
  const sw = page.getByRole('switch', { name: 'Document mode' })
  await sw.click()
  await expect(text).not.toHaveValue(/<table>/, { timeout: 120_000 })
  await expect(text).toHaveValue(/ใบแจ้งหนี้/)

  // Switching while a read is in progress: that read finishes in the old mode, then the
  // page is read again in the mode the switch now shows.
  await sw.click()
  await expect(page.getByRole('status', { name: 'Reading…' })).toBeVisible()
  await sw.click()
  await expect(sw).toHaveAttribute('aria-checked', 'false')
  await expect(page.getByText('AksonOCR-Lite', { exact: true })).toBeVisible({ timeout: 120_000 })
  await page.waitForTimeout(2000)
  await expect(text).not.toHaveValue(/<table>/)
  await expect(page.getByText('AksonOCR-Lite', { exact: true })).toBeVisible()
  expect(errors).toEqual([])
})
