import { createReadStream, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import multer from 'multer'
import { Router } from 'express'
import { config } from './config.js'
import { requireAuth } from './middleware/requireAuth.js'

/** multer storage rooted at FILES_DIR/{org_id}/{subdir}/ — org_id comes from the
 * authenticated caller's claims, never the request body, so uploads can't cross
 * tenants. Routes wire `field` per use (e.g. multer({ storage }).single('photo')). */
export const storage = multer.diskStorage({
  destination(req, _file, cb) {
    const orgId = req.claims?.org_id
    if (!orgId) return cb(new Error('missing_org_context'), '')
    const dir = path.join(config.FILES_DIR, orgId, req.body?.subdir || 'uploads')
    mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename(_req, file, cb) {
    cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
  },
})

export const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } })

export const filesRouter = Router()

// Streaming download, org-scoped: /api/files/reports/some-file.xlsx resolves to
// FILES_DIR/{caller's org_id}/reports/some-file.xlsx. Same-origin API — no signed
// URLs needed (Phase 6 wires the report/photo/attachment producers).
filesRouter.get('/files/*filePath', requireAuth, (req, res) => {
  const orgId = req.claims?.org_id
  if (!orgId) return res.status(403).json({ error: 'no_org_context' })

  const segments = (req.params.filePath as unknown as string[]) ?? []
  const relPath = path.normalize(path.join(...segments))
  if (relPath.startsWith('..')) return res.status(400).json({ error: 'invalid_path' })

  const fullPath = path.join(config.FILES_DIR, orgId, relPath)
  if (!existsSync(fullPath)) return res.status(404).json({ error: 'not_found' })

  createReadStream(fullPath).pipe(res)
})
