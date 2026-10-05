import { Router } from 'express'
import { pool } from '../db.js'
import { versionInfo } from '../version.js'

// Liveness and build info for monitors and support (docs/OPERATIONS.md,
// scripts/support-bundle.mjs). Public: mounted before any auth gate. Not to be
// confused with asset health (health.ts, healthService.ts).
export const systemRouter = Router()

systemRouter.get('/health', async (_req, res) => {
  try {
    await pool.query('select 1')
    res.json({ ok: true, db: 'up' })
  } catch (err) {
    res.status(503).json({ ok: false, db: 'down', error: (err as Error).message })
  }
})

systemRouter.get('/version', async (_req, res) => {
  res.json(await versionInfo())
})
