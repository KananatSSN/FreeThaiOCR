import { defineConfig, devices } from '@playwright/test'

// Uses the locally installed Chrome (no browser download). CI installs one with
// `npx playwright install chromium` and sets PW_CHANNEL=chromium.
// PW_BASE_URL=http://localhost:8080 runs the suite against the production
// container (nginx headers, CSP, service worker) instead of the dev server.
const external = process.env.PW_BASE_URL
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 60_000 },
  use: { baseURL: external ?? 'http://localhost:5173', channel: process.env.PW_CHANNEL ?? 'chrome', acceptDownloads: true },
  webServer: external ? undefined : { command: 'npm run dev -- --port 5173 --strictPort', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 120_000 },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], channel: process.env.PW_CHANNEL ?? 'chrome' }, testIgnore: /mobile/ },
    { name: 'mobile', use: { ...devices['Pixel 7'], channel: process.env.PW_CHANNEL ?? 'chrome' }, testMatch: /mobile|support/ },
  ],
})
