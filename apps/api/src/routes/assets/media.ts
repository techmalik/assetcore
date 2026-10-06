import { Router } from 'express'
import { withOrgContext } from '../../db.js'
import { claimsFromReq } from '../../claims.js'
import { requireCap } from '../../middleware/rbac.js'
import { auditFromReq } from '../../audit.js'
import { uploadRoute, deleteUploadedFile, IMAGE_MIME_TYPES, DOCUMENT_MIME_TYPES } from '../../files.js'
import { ASSET_SELECT } from '../../services/assets.js'

export const mediaRouter = Router()

const PHOTO_UPLOAD = { subdir: 'assets', field: 'photo', mime: IMAGE_MIME_TYPES, maxBytes: 10 * 1024 * 1024 }
const DOCUMENT_UPLOAD = { subdir: 'asset-documents', field: 'document', mime: DOCUMENT_MIME_TYPES, maxBytes: 25 * 1024 * 1024 }

const MAX_PHOTOS = 5

mediaRouter.post('/assets/:id/photos', requireCap('asset:update'), ...uploadRoute(PHOTO_UPLOAD, async (req, res, file) => {
  const url = file.url

  const result = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: cur } = await c.query('select coalesce(jsonb_array_length(photos), 0) as n from public.assets where id = $1', [req.params.id])
    if (!cur[0]) return { error: 'not_found' as const }
    if (cur[0].n >= MAX_PHOTOS) return { error: 'photo_limit' as const }
    await c.query(`update public.assets set photos = photos || $2::jsonb where id = $1`, [req.params.id, JSON.stringify([url])])
    const { rows: full } = await c.query(`${ASSET_SELECT} where a.id = $1`, [req.params.id])
    const asset = full[0]
    await auditFromReq(c, req, { action: 'asset.attachment.add', entityType: 'asset', entityId: asset.id, after: { kind: 'photo', url } })
    return { data: asset }
  })
  if ('error' in result) {
    if (result.error === 'not_found') return res.status(404).json({ error: 'not_found' })
    return res.status(400).json({ error: 'photo_limit', max: MAX_PHOTOS })
  }
  res.status(201).json(result.data)
}))

mediaRouter.delete('/assets/:id/photos', requireCap('asset:update'), async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url : null
  if (!url) return res.status(400).json({ error: 'invalid_request' })
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `update public.assets
       set photos = coalesce((select jsonb_agg(p) from jsonb_array_elements(photos) p where p <> to_jsonb($2::text)), '[]'::jsonb)
       where id = $1 returning id, org_id`,
      [req.params.id, url]
    )
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${ASSET_SELECT} where a.id = $1`, [req.params.id])
    const asset = full[0]
    await auditFromReq(c, req, { action: 'asset.attachment.remove', entityType: 'asset', entityId: rows[0].id, before: { kind: 'photo', url } })
    return asset
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  await deleteUploadedFile(req.claims!.org_id!, url)
  res.json(row)
})

mediaRouter.post('/assets/:id/documents', requireCap('asset:update'), ...uploadRoute(DOCUMENT_UPLOAD, async (req, res, file) => {
  const doc = { url: file.url, name: file.name, size: file.size }

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(`update public.assets set documents = documents || $2::jsonb where id = $1 returning id, org_id`, [req.params.id, JSON.stringify([doc])])
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${ASSET_SELECT} where a.id = $1`, [req.params.id])
    const asset = full[0]
    await auditFromReq(c, req, { action: 'asset.attachment.add', entityType: 'asset', entityId: rows[0].id, after: { kind: 'document', ...doc } })
    return asset
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(201).json(row)
}))

mediaRouter.delete('/assets/:id/documents', requireCap('asset:update'), async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url : null
  if (!url) return res.status(400).json({ error: 'invalid_request' })
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `update public.assets
       set documents = coalesce((select jsonb_agg(d) from jsonb_array_elements(documents) d where d->>'url' <> $2), '[]'::jsonb)
       where id = $1 returning id, org_id`,
      [req.params.id, url]
    )
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${ASSET_SELECT} where a.id = $1`, [req.params.id])
    const asset = full[0]
    await auditFromReq(c, req, { action: 'asset.attachment.remove', entityType: 'asset', entityId: rows[0].id, before: { kind: 'document', url } })
    return asset
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  await deleteUploadedFile(req.claims!.org_id!, url)
  res.json(row)
})
