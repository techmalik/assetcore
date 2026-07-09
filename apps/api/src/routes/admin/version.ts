import { Router } from 'express'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { ownerPool } from '../../db.js'

export const adminVersionRouter = Router()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf8'))

// Same data as the public /api/version, mounted under /admin so support staff
// can confirm a client instance's build during a support session without
// needing an unauthenticated probe endpoint.
adminVersionRouter.get('/version', async (_req, res) => {
  let latestMigration: string | null = null
  try {
    const { rows } = await ownerPool.query(
      'select version from public.schema_migrations order by applied_at desc limit 1'
    )
    latestMigration = rows[0]?.version ?? null
  } catch {
    latestMigration = null
  }
  res.json({ version: pkg.version, latestMigration })
})
