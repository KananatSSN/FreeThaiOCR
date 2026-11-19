import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const fixture = (f: string) => path.join(import.meta.dirname, '..', 'fixtures', f)

async function pdfText(file: string): Promise<string[]> {
  const doc = await getDocument({ data: new Uint8Array(readFileSync(file)) }).promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent()
    pages.push(c.items.map((it) => ('str' in it ? it.str : '')).join(' '))
  }
  return pages
}

test('PDF: every page OCR\'d (born-digital too), exports', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto('/?lng=en')
  await page.locator('input[type=file]').first().setInputFiles(fixture('sample.pdf'))

  // Page 1 has its own text layer, but the text shown is the model's reading of it.
  await expect(page.getByText('Page 1 of 3')).toBeVisible()
  await expect(page.locator('textarea').first()).toHaveValue(/ใบแจ้งค่าบริการ/, { timeout: 90_000 })
  await expect(page.getByText('OpenThai 2.1', { exact: true })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: 'All pages read' })).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.locator('textarea').first()).toHaveValue(/ประกาศเรื่องการปรับปรุงระบบบริการออนไลน์/)
  await page.screenshot({ path: 'test-results/pdf-page2.png' })

  const dl = async (item: string) => {
    await page.getByRole('button', { name: 'Export' }).click()
    const wait = page.waitForEvent('download')
    await page.getByRole('menuitem', { name: item, exact: true }).click()
    const d = await wait
    const p = test.info().outputPath(d.suggestedFilename())
    await d.saveAs(p)
    return p
  }
  const txt = readFileSync(await dl('Text file (.txt)'), 'utf8')
  expect(txt).toContain('--- 3 ---')
  expect(txt).toContain('จดหมายข่าวประจำเดือน')
  const json = JSON.parse(readFileSync(await dl('JSON with positions (.json)'), 'utf8'))
  expect(json.pages).toHaveLength(3)
  expect(json.pages.map((p: { engine: string }) => p.engine)).toEqual(Array(3).fill('OpenThai2.1-OCR-Text-20261118'))
  expect(json.pages[0].lines.length).toBeGreaterThan(0)
  expect(json.pages[1].lines[0].box).toHaveLength(4)

  const pdfPath = await dl('Searchable PDF')
  const pages = await pdfText(pdfPath)
  expect(pages).toHaveLength(3)
  const squash = (s: string) => s.replace(/\s+/g, '')
  // Scanned pages now carry an invisible OCR text layer that extracts as Thai.
  expect(squash(pages[1])).toContain('ประกาศเรื่องการปรับปรุงระบบบริการออนไลน์')
  expect(squash(pages[2])).toContain('จดหมายข่าวประจำเดือน')
  // The born-digital page keeps its own text and gets no second (OCR) layer, so nothing is doubled.
  expect(squash(pages[0])).toContain('INV-2026-0187')
  expect(squash(pages[0]).split('INV-2026-0187')).toHaveLength(2)
  expect(errors).toEqual([])
})
