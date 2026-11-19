import path from 'node:path'
import { expect, test } from '@playwright/test'

// The service worker exists only in production builds: run with PW_BASE_URL.
test.skip(!process.env.PW_BASE_URL, 'needs the production build (PW_BASE_URL)')

test('after one visit, OCR works offline from the service worker cache', async ({ page, context }) => {
  const img = path.join(import.meta.dirname, '..', 'fixtures', 'line_crop.png')
  await page.goto('/?lng=en')
  await page.evaluate(() => navigator.serviceWorker.ready)
  // First visit: the OCR run pulls the runtime and models into the cache.
  await page.locator('input[type=file]').first().setInputFiles(img)
  await expect(page.locator('textarea').first()).toHaveValue(/ประกาศเรื่อง/)

  // Count what the network serves on a repeat visit: the big files must come from the cache.
  const fromNetwork: string[] = []
  page.on('response', (r) => {
    if (!r.fromServiceWorker() && /\.(wasm|onnx)$|opencv/.test(r.url())) fromNetwork.push(r.url())
  })
  await context.setOffline(true)
  await page.reload()
  await page.locator('input[type=file]').first().setInputFiles(img)
  await expect(page.locator('textarea').first()).toHaveValue(/ประกาศเรื่อง/)
  expect(fromNetwork).toEqual([])
})
