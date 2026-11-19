import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'

const envFile = path.join(import.meta.dirname, '..', '..', '.env')
const env = (k: string) => (process.env[k] ?? (existsSync(envFile) ? new RegExp(`^${k}=(.*)$`, 'm').exec(readFileSync(envFile, 'utf8'))?.[1] : ''))?.trim()

test('privacy policy and terms pages, licenses file and links', async ({ page, request }) => {
  await page.goto('/privacy?lng=en')
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeVisible()
  await expect(page.getByText(/your images and PDFs never leave your device/)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Your rights' })).toBeVisible()
  const contact = page.getByRole('link', { name: env('VITE_CONTACT_EMAIL') || /GitHub issues/ }).first()
  if (env('VITE_CONTACT_EMAIL')) await expect(contact).toHaveAttribute('href', `mailto:${env('VITE_CONTACT_EMAIL')}`)
  else if (env('VITE_REPO_URL')) await expect(contact).toHaveAttribute('href', `${env('VITE_REPO_URL')}/issues`)
  await page.screenshot({ path: 'test-results/privacy.png', fullPage: true })

  await page.goto('/terms?lng=th')
  await expect(page.getByRole('heading', { level: 1, name: 'ข้อกำหนดการใช้งาน' })).toBeVisible()
  await expect(page.getByText(/ไม่ใช่การบริจาคเพื่อการกุศล/)).toBeVisible()

  const lic = await request.get('/licenses.txt')
  expect(lic.ok()).toBe(true)
  const text = await lic.text()
  for (const s of ['FreeThaiOCR is licensed under the Apache License 2.0', 'OpenThai2.1-OCR-Text-20261118', 'AksonOCR-Lite', 'Table Transformer', 'onnxruntime-web@', 'Copyright (c) Microsoft Corporation', 'pdfjs-dist@', 'SIL Open Font License']) expect(text).toContain(s)

  // Landing page footer, and About links open in a new tab (work in progress is kept).
  await page.goto('/?lng=en')
  await expect(page.getByRole('navigation', { name: 'Legal' }).getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy')
  await page.getByRole('button', { name: 'About' }).click()
  const aboutPrivacy = page.getByRole('dialog').getByRole('link', { name: 'Privacy policy' })
  await expect(aboutPrivacy).toHaveAttribute('target', '_blank')
})
