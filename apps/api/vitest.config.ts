import { defineConfig } from 'vitest/config'

// Disposable-Postgres integration tests (see test/README.md). Defaults point
// at a local `assetcore_test` database on the same Postgres instance dev
// uses — override TEST_DATABASE_URL(_OWNER) to point elsewhere (e.g. CI).
const DATABASE_URL = process.env.TEST_DATABASE_URL
  || 'postgres://assetcore_app:assetcore_app@localhost:5432/assetcore_test'
const DATABASE_URL_OWNER = process.env.TEST_DATABASE_URL_OWNER
  || 'postgres://postgres:postgres@localhost:5432/assetcore_test'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 20_000,
    hookTimeout: 30_000,
    // Fixtures are seeded once (idempotently) and shared across test files
    // against one real database — running files concurrently would race on
    // the same rows. Sequential is fine at this suite's size.
    fileParallelism: false,
    globalSetup: ['./test/globalSetup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL,
      DATABASE_URL_OWNER,
      APP_ORIGIN: 'http://localhost:5174',
      JWT_SECRET: 'test-only-secret-do-not-use-in-prod-0123456789',
      JWT_ACCESS_TTL: '60m',
      FILES_DIR: './test/tmp/files',
      LOGS_DIR: './test/tmp/logs',
      TZ: 'Africa/Lagos',
    },
  },
})
