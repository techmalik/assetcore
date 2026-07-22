import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../../..')

// Runs scripts/migrate.mjs against the test database before the suite starts
// (idempotent — already-applied migrations are skipped), so `npm test` is
// self-contained once the disposable Postgres + `assetcore_test` database
// exist. See test/README.md for the one-time setup.
export default async function globalSetup() {
  const databaseUrlOwner = process.env.TEST_DATABASE_URL_OWNER
    || 'postgres://postgres:postgres@localhost:5432/assetcore_test'

  execFileSync('node', [path.join(repoRoot, 'scripts', 'migrate.mjs')], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL_OWNER: databaseUrlOwner },
    stdio: 'inherit',
  })
}
