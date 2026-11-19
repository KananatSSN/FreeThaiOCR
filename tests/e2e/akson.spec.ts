import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'

const fixture = (f: string) => path.join(import.meta.dirname, '..', 'fixtures', f)
test.describe.configure({ mode: 'serial' })

async function chooseAkson(page: Page) {
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('menuitemradio', { name: /AksonOCR-Lite/ }).click()
  await page.getByRole('button', { name: 'Download and use' }).click()
}

test('AksonOCR-Lite: pick it, read a page, choice is remembered', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto('/?lng=en')
  await page.locator('input[type=file]').first().setInputFiles(fixture('th_doc.png'))
  await chooseAkson(page)
  await page.getByRole('button', { name: /OCR page/ }).click()
  await expect(page.locator('textarea').first()).toHaveValue(/ประกาศเรื่องการปรับปรุงระบบบริการออนไลน์/, { timeout: 120_000 })
  await expect(page.getByText('AksonOCR-Lite', { exact: true })).toBeVisible()

  await page.reload()
  await page.locator('input[type=file]').first().setInputFiles(fixture('th_doc.png'))
  await page.getByRole('button', { name: 'Settings' }).click()
  await expect(page.getByRole('menuitemradio', { name: /AksonOCR-Lite/ })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('menuitemradio', { name: /OpenThai 2.1/ })).toHaveAttribute('aria-checked', 'false')
  expect(errors).toEqual([])
})

test('AksonOCR-Lite document mode: tables as Markdown, .md and .txt exports', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/?lng=en')
  await page.locator('input[type=file]').first().setInputFiles(fixture('invoice.png'))
  // The engine choice from the previous test is remembered per browser profile, not per test:
  // pick it again in this fresh context.
  await chooseAkson(page)
  await page.getByRole('button', { name: 'Settings' }).click()
  await page.getByRole('menuitemcheckbox', { name: /Document mode/ }).click()
  await page.getByRole('button', { name: 'Download and use' }).click()
  await page.getByRole('button', { name: /OCR page/ }).click()
  const text = page.locator('textarea').first()
  await expect(text).toHaveValue(/<table>/, { timeout: 180_000 })
  await expect(text).toHaveValue(/## ใบแจ้งหนี้ เลขที่ INV-2569-0412/)
  // Same as the reference: TATR merges the label over two of the five columns.
  await expect(text).toHaveValue(/<td colspan="2">ภาษีมูลค่าเพิ่ม 7%<\/td>/)
  await expect(page.getByText('AksonOCR-Lite · Markdown')).toBeVisible()

  const save = async (item: string) => {
    await page.getByRole('button', { name: 'Export' }).click()
    const wait = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: item, exact: true }).click()
    const d = await wait
    const p = test.info().outputPath(d.suggestedFilename())
    await d.saveAs(p)
    return { name: d.suggestedFilename(), body: readFileSync(p, 'utf8') }
  }
  const md = await save('Markdown (.md)')
  expect(md.name).toBe('invoice.md')
  expect(md.body).toContain('<th>รายการ</th>')
  const txt = await save('Text file (.txt)')
  expect(txt.body).toContain('ลำดับ\tรายการ\tจำนวน')
  expect(txt.body).not.toContain('<td')
  expect(errors).toEqual([])
})
