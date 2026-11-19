import path from 'node:path'
import { expect, test } from '@playwright/test'

const fixture = (f: string) => path.join(import.meta.dirname, '..', 'fixtures', f)

test.describe.configure({ mode: 'serial' })

test('isolated, reads the page automatically', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  await page.goto('/?lng=en')
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true)

  await page.locator('input[type=file]').first().setInputFiles(fixture('th_doc.png'))
  const textarea = page.locator('textarea').first()
  await expect(textarea).toHaveValue(/ประกาศเรื่องการปรับปรุงระบบบริการออนไลน์/)
  await page.screenshot({ path: 'test-results/page-ocr.png' })

  expect(errors.filter((e) => !/favicon/.test(e))).toEqual([])
})

test('2.1 runtime: rec2 is fetched only when needed; digit cells and decimal commas', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const rec2: string[] = []
  context.on('request', (r) => /\/models\/[^/]+\/rec2\.onnx$/.test(r.url()) && rec2.push(r.url()))
  await page.goto('/?lng=en')

  // English page: no line with Latin letters inside a Thai word, so no second recognizer.
  await page.locator('input[type=file]').first().setInputFiles(fixture('en_doc.png'))
  await expect(page.locator('textarea').first()).toHaveValue(/Quarterly Maintenance Notice/)
  expect(rec2).toEqual([])

  // Receipt in a loopless font: rec2 re-reads it; quantities kept, "120,00" -> "120.00".
  await page.goto('/?lng=en')
  await page.locator('input[type=file]').first().setInputFiles(fixture('receipt.png'))
  const text = page.locator('textarea').first()
  await expect(text).toHaveValue(/กาแฟเย็น 2 120\.00/)
  await expect(text).toHaveValue(/รวมทั้งสิ้น 6 280\.50/)
  await expect(text).toHaveValue(/วัน M T W H F/)
  expect(rec2.length).toBeGreaterThan(0) // twice behind the production service worker (its own fetch)
  expect(errors).toEqual([])
})
