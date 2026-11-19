import { readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { unzipSync } from 'fflate'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

const batchDir = path.join(import.meta.dirname, '..', 'fixtures', 'batch')
const squash = (s: string) => s.replace(/\s+/g, '')

async function pdfPages(data: Uint8Array): Promise<string[]> {
  const doc = await getDocument({ data }).promise
  const out: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent()
    out.push(squash(c.items.map((it) => ('str' in it ? it.str : '')).join('')))
  }
  return out
}

async function openFolder(page: Page) {
  await page.goto('/?lng=en')
  await page.getByTestId('pick-folder').first().setInputFiles(batchDir)
  const list = page.getByRole('complementary').or(page.locator('section'))
  await expect(page.getByText('title.png')).toBeVisible()
  return list
}

async function exportVia(page: Page, item: string) {
  await page.getByRole('button', { name: 'Export' }).click()
  const wait = page.waitForEvent('download', { timeout: 110_000 })
  await page.getByRole('menuitem', { name: item, exact: true }).click()
  const d = await wait
  const p = test.info().outputPath(d.suggestedFilename())
  await d.saveAs(p)
  return { name: d.suggestedFilename(), data: new Uint8Array(readFileSync(p)) }
}

test('folder: lists supported files in natural order, reads them all, ZIP of searchable PDFs', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openFolder(page)
  await expect(page.getByText(/Added 3 files · skipped 1 unsupported file/)).toBeVisible()
  const names = await page.locator('li button[aria-current]').allInnerTexts()
  expect(names.map((n) => n.split('\n')[0].trim())).toEqual(['scan-2.pdf', 'scan-10.pdf', 'title.png'])
  await expect(page.getByRole('button', { name: /^batch\/reports\// })).toBeVisible()

  // Every file is read without being asked.
  await expect(page.locator('li [aria-label="done"]')).toHaveCount(3, { timeout: 110_000 })
  await expect(page.getByRole('status').filter({ hasText: 'All pages read' })).toBeVisible()
  await page.screenshot({ path: 'test-results/batch-done.png' })

  const zip = await exportVia(page, 'Searchable PDFs')
  expect(zip.name).toBe('batch-freethaiocr.zip')
  const entries = unzipSync(zip.data)
  expect(Object.keys(entries).sort()).toEqual(['batch/reports/scan-10-searchable.pdf', 'batch/reports/scan-2-searchable.pdf', 'batch/title-searchable.pdf'])
  expect((await pdfPages(entries['batch/reports/scan-2-searchable.pdf']))[0]).toContain('ประกาศเรื่องการปรับปรุงระบบบริการออนไลน์')
  expect((await pdfPages(entries['batch/reports/scan-10-searchable.pdf']))[0]).toContain('โปรโมชันพิเศษสำหรับสมาชิก')
  expect((await pdfPages(entries['batch/title-searchable.pdf']))[0]).toContain('ประกาศเรื่อง')

  const txt = unzipSync((await exportVia(page, 'Text files (.txt)')).data)
  expect(new TextDecoder().decode(txt['batch/title.txt'])).toContain('ประกาศเรื่อง')
  expect(errors).toEqual([])
})

test('export of one file reads its missing pages first', async ({ page }) => {
  await openFolder(page)
  await page.getByRole('button', { name: /scan-2\.pdf \d+\/\d+/ }).click()
  // Exporting straight away: pages not read yet in the background are read for the export.
  const pdf = await exportVia(page, 'Searchable PDF')
  expect(pdf.name).toBe('scan-2-searchable.pdf')
  expect((await pdfPages(pdf.data))[0]).toContain('ประกาศเรื่องการปรับปรุงระบบบริการออนไลน์')
  await expect(page.locator('textarea').first()).toHaveValue(/ประกาศเรื่อง/)
})

test.describe('cancel', () => {
  // Route model downloads ourselves (a service worker would bypass context.route).
  test.use({ serviceWorkers: 'block' })

test('cancelling an export downloads nothing and keeps finished pages', async ({ page, context }) => {
  // Hold the model download so the batch is guaranteed to still be running when
  // Cancel is pressed (otherwise three small files can finish first under load).
  await context.route(/\/models\/.*\.onnx$/, async (route) => {
    await new Promise((r) => setTimeout(r, 3000))
    await route.continue()
  })
  await openFolder(page)
  let downloaded = false
  page.on('download', () => (downloaded = true))
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('menuitem', { name: 'Searchable PDFs' }).click()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Export cancelled')).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(1500)
  expect(downloaded).toBe(false)
  // The app is usable again: Export is enabled and background reading carries on to the end.
  await expect(page.getByRole('button', { name: 'Export' })).toBeEnabled()
  await expect(page.getByRole('status').filter({ hasText: 'All pages read' })).toBeVisible({ timeout: 110_000 })
})

test('background reading stops and resumes', async ({ page, context }) => {
  // Hold the model download so reading is still going when Stop is pressed.
  await context.route(/\/models\/.*\.onnx$/, async (route) => {
    await new Promise((r) => setTimeout(r, 3000))
    await route.continue()
  })
  await openFolder(page)
  await page.getByRole('button', { name: 'Stop' }).click()
  const stopped = page.getByRole('status').filter({ hasText: /Stopped at \d+ \/ \d+ pages/ })
  await expect(stopped).toBeVisible()
  // The page being read when Stop was pressed finishes; nothing after it starts.
  await page.waitForTimeout(8000)
  const [, done, total] = (await stopped.innerText()).match(/Stopped at (\d+) \/ (\d+)/)!.map(Number)
  expect(done).toBeLessThan(total)
  await page.getByRole('button', { name: 'Resume' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'All pages read' })).toBeVisible({ timeout: 110_000 })
})
})

test('folders fold like an accordion and keep their progress visible', async ({ page }) => {
  await openFolder(page)
  const reports = page.getByRole('button', { name: /^batch\/reports\// })
  const scan10 = page.getByRole('button', { name: /scan-10\.pdf \d+\/\d+/ })
  await expect(reports).toHaveAttribute('aria-expanded', 'true')
  await expect(reports).toContainText(/\d\/2/)

  await reports.click()
  await expect(reports).toHaveAttribute('aria-expanded', 'false')
  await expect(scan10).toBeHidden()
  await expect(page.getByRole('button', { name: /title\.png \d+\/\d+/ })).toBeVisible() // other folder untouched
  await page.screenshot({ path: 'test-results/folders-folded.png', clip: { x: 0, y: 0, width: 420, height: 320 } })

  // Folded folders still show progress as their files get read in the background.
  await page.screenshot({ path: 'test-results/toolbar-progress.png', clip: { x: 0, y: 0, width: 900, height: 120 } })
  await expect(reports).toContainText('2/2', { timeout: 110_000 })

  await reports.click()
  await expect(scan10).toBeVisible()

  // Collapse all / expand all from the ⋯ menu.
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Collapse all folders' }).click()
  await expect(page.locator('section button[aria-expanded="true"]')).toHaveCount(0)
  await page.getByRole('button', { name: 'More' }).click()
  await page.getByRole('menuitem', { name: 'Expand all folders' }).click()
  await expect(page.locator('section button[aria-expanded="false"]')).toHaveCount(0)

  // The open file is never hidden: removing the open file makes the next one
  // (title.png, in the folded batch/ folder) current, which unfolds batch/.
  const batchFolder = page.getByRole('button', { name: /^batch\/(?!reports)/ })
  await batchFolder.click()
  await expect(batchFolder).toHaveAttribute('aria-expanded', 'false')
  await scan10.click()
  await page.getByRole('button', { name: 'Remove scan-10.pdf' }).click()
  await expect(batchFolder).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByRole('button', { name: /title\.png \d+\/\d+/ })).toHaveAttribute('aria-current', 'true')
})

test('protected (encrypted) PDF: searchable export is refused with a reason, TXT still works', async ({ page }) => {
  await page.goto('/?lng=en')
  await page.getByTestId('pick-files').first().setInputFiles(path.join(import.meta.dirname, '..', 'fixtures', 'encrypted', 'protected.pdf'))
  let downloads = 0
  page.on('download', () => downloads++)
  await page.getByRole('button', { name: 'Export' }).click()
  await page.getByRole('menuitem', { name: 'Searchable PDF', exact: true }).click()
  await expect(page.getByText(/protected\.pdf is a protected \(encrypted\) PDF/)).toBeVisible({ timeout: 90_000 })
  expect(downloads).toBe(0)
  const txt = await exportVia(page, 'Text file (.txt)')
  expect(new TextDecoder().decode(txt.data)).toContain('ประกาศเรื่อง')
})
