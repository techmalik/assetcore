// Browser smoke test: signs in as each role and opens every page.
// `npm run e2e` builds a fresh database first (scripts/e2e-db.mjs), then this
// starts the API and the app on their own ports so a dev server already
// running on 8787/5173 is left alone.
import { defineConfig, devices } from '@playwright/test'

const ownerUrl = process.env.E2E_DATABASE_URL_OWNER
  || 'postgres://postgres:postgres@localhost:5432/assetcore_e2e'
const appUrl = new URL(ownerUrl)
appUrl.username = 'assetcore_app'
appUrl.password = 'assetcore_app'

const API_PORT = 8797
const APP_PORT = 5197

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
      env: {
        // The login limiter allows 10 attempts per 15 minutes outside tests;
        // NODE_ENV=test raises it, and changes nothing else.
        NODE_ENV: 'test',
        PORT: String(API_PORT),
        DATABASE_URL: appUrl.toString(),
        DATABASE_URL_OWNER: ownerUrl,
        APP_ORIGIN: `http://localhost:${APP_PORT}`,
        JWT_SECRET: 'e2e-only-secret-do-not-use-in-prod-0123456789',
        FILES_DIR: './test-results/e2e-files',
        LOGS_DIR: './test-results/e2e-logs',
        TZ: 'Africa/Lagos',
      },
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
