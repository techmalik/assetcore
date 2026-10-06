// Browser smoke test: signs in as each role and opens every page.
// `npm run e2e` builds a fresh database first (scripts/e2e-db.mjs), then this
// starts the API and the app on their own ports so a dev server already
// running on 8787/5173 is left alone.
import { defineConfig, devices } from '@playwright/test'
import { API_PORT, APP_PORT, apiEnv } from './e2e/env.mjs'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 120_000,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: `http://localhost:${APP_PORT}`,
    ...devices['Desktop Chrome'],
    // Full Chromium in its new headless mode, the same browser users run,
    // rather than the separate headless shell build.
    channel: 'chromium',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npx tsx apps/api/src/index.ts',
      url: `http://localhost:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: apiEnv,
    },
    {
      command: 'npm run dev:app',
      url: `http://localhost:${APP_PORT}`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { PORT: String(APP_PORT), VITE_API_PROXY_TARGET: `http://localhost:${API_PORT}` },
    },
  ],
})
