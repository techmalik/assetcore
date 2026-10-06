// The environment the smoke test's API runs with, shared by
// playwright.config.js (which starts the API) and scripts/e2e-db.mjs (whose
// seed runs the API's health rescore, which loads the same config). Nothing
// comes from apps/api/.env, so the run is the same locally and in CI.
export const API_PORT = 8797
export const APP_PORT = 5197

export const ownerUrl = process.env.E2E_DATABASE_URL_OWNER
  || 'postgres://postgres:postgres@localhost:5432/assetcore_e2e'

const appUrl = new URL(ownerUrl)
appUrl.username = 'assetcore_app'
appUrl.password = 'assetcore_app'

export const apiEnv = {
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
}
