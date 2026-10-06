import { createReadStream, existsSync, mkdirSync } from 'node:fs'
import { open as openFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import multer from 'multer'
import { Router, type Request, type Response, type RequestHandler } from 'express'
import type { PoolClient } from 'pg'
import { config } from './config.js'
import { withOrgContext } from './db.js'
import { claimsFromReq } from './claims.js'
import { logger } from './logger.js'

/** multer storage rooted at FILES_DIR/{org_id}/{subdir}/ — org_id comes from the
 * authenticated caller's claims, never the request body, so uploads can't cross
 * tenants. One fixed-subdir instance per upload surface (asset photos, WO
 * attachments, compliance documents) — no reliance on multipart field ordering. */
function uploadTo(subdir: string, opts: { maxSizeBytes?: number } = {}) {
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
function guardedSingle(mw: RequestHandler): RequestHandler {
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
// Legacy Office files (.doc/.xls/.ppt) and Outlook .msg share the OLE
// compound-file signature.
// CSV and plain text (logger exports, meter readings, notes) have no
// signature. They are accepted only under a .csv or .txt name and only when
// the content reads as text (see looksLikeText), so an HTML page renamed
// invoice.pdf is still refused.
export const DOCUMENT_MIME_TYPES = [...IMAGE_MIME_TYPES, 'application/pdf', 'application/zip', 'application/x-ole-storage', 'text/csv', 'text/plain'] as const

const TEXT_EXTENSIONS: Record<string, string> = { '.csv': 'text/csv', '.txt': 'text/plain' }

/** Whether the bytes are UTF-8 text: no NUL bytes, and they decode. Only the
 * first 64 KB are read; a multi-byte character cut at that edge is fine. */
function looksLikeText(sample: Buffer): boolean {
  if (sample.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample, { stream: true })
    return true
  } catch {
    return false
  }
}

async function sniffMime(filePath: string, originalName = ''): Promise<string | null> {
  const fh = await openFile(filePath, 'r')
  try {
    const buf = Buffer.alloc(64 * 1024)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    const head = buf.subarray(0, Math.min(16, bytesRead))
    if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg'
    if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
    if (head.length >= 12 && head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
    if (head.length >= 4 && head.subarray(0, 4).toString('ascii') === '%PDF') return 'application/pdf'
    if (head.length >= 4 && head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'application/zip'
    if (head.length >= 8 && head.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return 'application/x-ole-storage'
    const textType = TEXT_EXTENSIONS[path.extname(originalName).toLowerCase()]
    if (textType && bytesRead > 0 && looksLikeText(buf.subarray(0, bytesRead))) return textType
    return null
  } finally {
    await fh.close()
  }
}

/** Best-effort delete of a just-written upload after the DB write that was
 * supposed to reference it fails (or the referenced row turns out not to
 * exist) — otherwise the file is orphaned on disk with nothing pointing to
 * it. Never throws; logs and swallows so cleanup failure doesn't mask the
 * original error the caller is already handling. */
async function cleanupOrphanedUpload(filePath: string | undefined | null): Promise<void> {
  if (!filePath) return
  await unlink(filePath).catch((err) => {
    logger.warn({ err, filePath }, 'failed to clean up orphaned upload')
  })
}

/** Best-effort delete of an upload's on-disk file once the DB row/array entry
 * that referenced it has been removed — the counterpart to
 * cleanupOrphanedUpload for the "remove attachment" side of the lifecycle, so
 * disk usage doesn't grow unbounded from photos/documents users delete.
 * `relPath` is the same org-relative path stored in the DB (e.g.
 * `assets/172-photo.jpg`), resolved the same way filesRouter resolves it for
 * download. Never throws. */
export async function deleteUploadedFile(orgId: string, relPath: string): Promise<void> {
  const fullPath = path.join(config.FILES_DIR, orgId, relPath)
  await unlink(fullPath).catch((err) => {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn({ err, fullPath }, 'failed to delete removed upload')
    }
  })
}

/** A file that has passed the size limit and the content check. `url` is the
 * org-relative path stored in the database and served by /api/files. */
type UploadedFile = { url: string; name: string; size: number; mime: string; path: string }
type UploadOpts = { subdir: string; field: string; mime: readonly string[]; maxBytes?: number }
type UploadHandler<F> = (req: Request, res: Response, file: F) => Promise<unknown>

/**
 * Every upload route, in one shape: multer into FILES_DIR/{org}/{subdir},
 * a too-large file answered 400 file_too_large, a missing file 400
 * missing_file, the content sniffed against `mime` (400 unsupported_type),
 * and the stored file deleted again if the handler throws or answers an
 * error. Ten routes used to write this out by hand, and six of them skipped
 * the size answer and the content check.
 */
export function uploadRoute(opts: UploadOpts, handler: UploadHandler<UploadedFile>): RequestHandler[] {
  return buildUploadRoute(opts, true, handler as UploadHandler<UploadedFile | null>)
}

/** uploadRoute for a form where the file is optional: `file` is null when
 * none was sent. */
export function optionalUploadRoute(opts: UploadOpts, handler: UploadHandler<UploadedFile | null>): RequestHandler[] {
  return buildUploadRoute(opts, false, handler)
}

function buildUploadRoute(opts: UploadOpts, required: boolean, handler: UploadHandler<UploadedFile | null>): RequestHandler[] {
  const upload = uploadTo(opts.subdir, { maxSizeBytes: opts.maxBytes })
  const run: RequestHandler = async (req, res) => {
    if (!req.file) {
      if (required) return void res.status(400).json({ error: 'missing_file' })
      await handler(req, res, null)
      return
    }
    const mime = await sniffMime(req.file.path, req.file.originalname)
    if (!mime || !opts.mime.includes(mime)) {
      await cleanupOrphanedUpload(req.file.path)
      return void res.status(400).json({ error: 'unsupported_type' })
    }
    const file: UploadedFile = {
      url: `${opts.subdir}/${req.file.filename}`,
      name: req.file.originalname,
      size: req.file.size,
      mime,
      path: req.file.path,
    }
    try {
      await handler(req, res, file)
    } catch (err) {
      await cleanupOrphanedUpload(file.path)
      throw err
    }
    if (res.statusCode >= 400) await cleanupOrphanedUpload(file.path)
  }
  return [guardedSingle(upload.single(opts.field)), run]
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
filesRouter.get('/files/*filePath', async (req, res) => {
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

  // A text upload is always a download, never a page: nosniff (helmet)
  // stops a browser guessing, and this stops it rendering one at all.
  if (TEXT_EXTENSIONS[path.extname(fullPath).toLowerCase()]) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment')
  }
  createReadStream(fullPath).pipe(res)
})
