import { createReadStream, existsSync, mkdirSync } from 'node:fs'
import { open as openFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import multer from 'multer'
import { Router, type RequestHandler } from 'express'
import type { PoolClient } from 'pg'
import { config } from './config.js'
import { withOrgContext } from './db.js'
import { claimsFromReq } from './claims.js'
import { requireAuth } from './middleware/requireAuth.js'

/** multer storage rooted at FILES_DIR/{org_id}/{subdir}/ — org_id comes from the
 * authenticated caller's claims, never the request body, so uploads can't cross
 * tenants. One fixed-subdir instance per upload surface (asset photos, WO
 * attachments, compliance documents) — no reliance on multipart field ordering. */
export function uploadTo(subdir: string, opts: { maxSizeBytes?: number } = {}) {
  const storage = multer.diskStorage({
    destination(req, _file, cb) {
      const orgId = req.claims?.org_id
      if (!orgId) return cb(new Error('missing_org_context'), '')
      const dir = path.join(config.FILES_DIR, orgId, subdir)
      mkdirSync(dir, { recursive: true })
      cb(null, dir)
    },
    filename(_req, file, cb) {
      cb(null, `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`)
    },
  })
  return multer({ storage, limits: { fileSize: opts.maxSizeBytes ?? 25 * 1024 * 1024 } })
}

/** Wraps a multer `.single(field)` middleware so a file-too-large rejection
 * comes back as a clean 400 instead of falling through to the generic 500
 * error handler (multer's own error otherwise just gets `next(err)`ed). */
export function guardedSingle(mw: RequestHandler): RequestHandler {
  return (req, res, next) => {
    mw(req, res, (err: unknown) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'file_too_large' })
        }
        return next(err as Error)
      }
      next()
    })
  }
}

// Magic-byte signatures for the file types this app accepts anywhere. Sniffed
// from the actual bytes written to disk — never trust multer's `mimetype`
// (it's just the client-supplied Content-Type header, freely spoofable).
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
// Office formats (docx/xlsx/pptx) are zip containers, so 'application/zip'
// covers them at the signature level along with plain .zip attachments.
export const DOCUMENT_MIME_TYPES = [...IMAGE_MIME_TYPES, 'application/pdf', 'application/zip'] as const

export async function sniffMime(filePath: string): Promise<string | null> {
  const fh = await openFile(filePath, 'r')
  try {
    const buf = Buffer.alloc(16)
    const { bytesRead } = await fh.read(buf, 0, 16, 0)
    const head = buf.subarray(0, bytesRead)
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
    if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
    if (head.length >= 12 && head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
    if (head.length >= 4 && head.subarray(0, 4).toString('ascii') === '%PDF') return 'application/pdf'
    if (head.length >= 4 && head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'application/zip'
    return null
  } finally {
    await fh.close()
  }
}

/** Validate an already-written upload against an allowlist by content, not
 * filename/header; deletes the file and returns false when it doesn't match
 * (caller is responsible for responding 400). */
export async function validateUploadOrCleanup(filePath: string, allowed: readonly string[]): Promise<boolean> {
  const mime = await sniffMime(filePath)
  if (mime && allowed.includes(mime)) return true
  await unlink(filePath).catch(() => {})
  return false
}

export const filesRouter = Router()

// Every upload surface's on-disk subdirectory, mapped to a check that a row
// visible to the CALLER'S CURRENT SCOPE (run through withOrgContext, so RLS's
// org + site-scope predicate applies exactly as it does for the owning
// table's own queries) references this exact relative path. The directory
// layout (FILES_DIR/{org_id}/{subdir}/...) already keeps files off-limits
// across orgs; this closes the remaining gap where a site-scoped caller could
// otherwise fetch another site's photo/document/report/attachment just by
// knowing (or guessing) its path.
type OwnershipCheck = (client: PoolClient, relPath: string) => Promise<boolean>
const exists = (c: PoolClient, sql: string, params: unknown[]) => c.query(sql, params).then((r) => (r.rowCount ?? 0) > 0)

const FILE_OWNERSHIP_CHECKS: Record<string, OwnershipCheck> = {
  assets: (c, p) => exists(c, 'select 1 from public.assets where photos @> $1::jsonb limit 1', [JSON.stringify([p])]),
  'asset-documents': (c, p) => exists(c, `select 1 from public.assets where exists (select 1 from jsonb_array_elements(documents) d where d->>'url' = $1) limit 1`, [p]),
  // work_order_activity carries the attachment but has no site-scoped RLS of
  // its own — joining through work_orders (which does) is what enforces scope.
  attachments: (c, p) => exists(c, `select 1 from public.work_order_activity wa join public.work_orders w on w.id = wa.work_order_id where exists (select 1 from jsonb_array_elements(coalesce(wa.attachments, '[]'::jsonb)) att where att->>'url' = $1) limit 1`, [p]),
  'inspection-reports': (c, p) => exists(c, 'select 1 from public.inspections where report_url = $1 limit 1', [p]),
  'maintenance-reports': (c, p) => exists(c, 'select 1 from public.pm_tasks where report_url = $1 limit 1', [p]),
  'maintenance-completions': (c, p) => exists(c, 'select 1 from public.maintenance_events where report_url = $1 limit 1', [p]),
  'compliance-documents': (c, p) => exists(c, `select 1 from public.compliance_licences where document_url = $1 or exists (select 1 from jsonb_array_elements(documents) d where d->>'url' = $1) limit 1`, [p]),
  'compliance-audits': (c, p) => exists(c, 'select 1 from public.compliance_audits where document_url = $1 limit 1', [p]),
  // Generated report exports are org-wide artifacts, not tied to a site.
  reports: (c, p) => exists(c, 'select 1 from public.reports where storage_path = $1 limit 1', [p]),
}

// Streaming download, org- AND site-scoped: /api/files/reports/some-file.xlsx
// resolves to FILES_DIR/{caller's org_id}/reports/some-file.xlsx, and — for
// every known upload bucket — only streams if a row the caller's current
// scope can see actually references that path.
filesRouter.get('/files/*filePath', requireAuth, async (req, res) => {
  const orgId = req.claims?.org_id
  if (!orgId) return res.status(403).json({ error: 'no_org_context' })

  const segments = (req.params.filePath as unknown as string[]) ?? []
  const relPath = path.normalize(path.join(...segments))
  if (relPath.startsWith('..')) return res.status(400).json({ error: 'invalid_path' })

  const fullPath = path.join(config.FILES_DIR, orgId, relPath)
  if (!existsSync(fullPath)) return res.status(404).json({ error: 'not_found' })

  const subdir = segments[0]
  const check = subdir ? FILE_OWNERSHIP_CHECKS[subdir] : undefined
  // Unrecognized buckets default-deny — a new upload surface must add a
  // resolver here before its files are downloadable.
  if (!check) return res.status(404).json({ error: 'not_found' })

  const visible = await withOrgContext(claimsFromReq(req), (c) => check(c, relPath))
  if (!visible) return res.status(404).json({ error: 'not_found' })

  createReadStream(fullPath).pipe(res)
})
