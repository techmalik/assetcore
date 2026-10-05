import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ownerPool } from './db.js'

// The build's own version, read once. apps/api/package.json is the source
// because it is the one the Docker image ships (apps/api/Dockerfile); its
// version is kept equal to the product version in the root package.json, and
// test/system.test.ts fails if the two part.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const APP_VERSION: string = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
).version

/** What /api/version and /api/admin/version answer: the build, and the last
 * migration this database has applied (null if that cannot be read). */
export async function versionInfo(): Promise<{ version: string; latestMigration: string | null }> {
  let latestMigration: string | null = null
  try {
    const { rows } = await ownerPool.query(
      'select version from public.schema_migrations order by applied_at desc limit 1'
    )
    latestMigration = rows[0]?.version ?? null
  } catch {
    latestMigration = null
  }
  return { version: APP_VERSION, latestMigration }
}
