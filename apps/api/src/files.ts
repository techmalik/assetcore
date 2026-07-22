import { createReadStream, existsSync, mkdirSync } from 'node:fs'
import { open as openFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import multer from 'multer'
import { Router, type RequestHandler } from 'express'
import { config } from './config.js'
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
