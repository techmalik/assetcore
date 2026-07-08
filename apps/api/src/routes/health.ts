import { Router } from 'express'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { pool, ownerPool } from '../db.js'

export const healthRouter = Router()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'))

healthRouter.get('/health', async (_req, res) => {
  try {
    await pool.query('select 1')
    res.json({ ok: true, db: 'up' })
  } catch (err) {
    res.status(503).json({ ok: false, db: 'down', error: (err as Error).message })
  }
})

healthRouter.get('/version', async (_req, res) => {
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
