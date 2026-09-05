import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'
import { can } from '../middleware/rbac.js'
import { writeAuditLog } from '../audit.js'
import { uploadTo } from '../files.js'

export const documentsRouter = Router()
documentsRouter.use(requireAuth, requireOrg, requireActiveMembership)

const documentUpload = uploadTo('documents')

const KINDS = ['photo', 'manual', 'warranty', 'certificate', 'drawing', 'report', 'invoice', 'other'] as const

// A document hangs off exactly one parent (enforced by a check constraint in
// 0002). Attaching to a parent means editing it, so each one maps to the
// capability that already governs edits of that record.
const PARENTS = {
  asset_id: { column: 'asset_id', capability: 'asset:update' },
  work_order_id: { column: 'work_order_id', capability: 'wo:update' },
  inspection_id: { column: 'inspection_id', capability: 'inspection:update' },
  compliance_licence_id: { column: 'compliance_licence_id', capability: 'compliance:update' },
} as const

type ParentKey = keyof typeof PARENTS

const SELECT = `
  select d.*,
    case when u.id is null then null else jsonb_build_object('id', u.id, 'full_name', u.full_name) end as uploader
  from public.documents d
  left join public.users u on u.id = d.uploaded_by
`

/** Reads the single parent key present in a query string or form body. */
function readParent(source: Record<string, unknown>): { key: ParentKey; id: string } | null {
  const present = (Object.keys(PARENTS) as ParentKey[]).filter(
    (k) => typeof source[k] === 'string' && source[k] !== ''
  )
  if (present.length !== 1) return null
  return { key: present[0], id: source[present[0]] as string }
}

documentsRouter.get('/documents', async (req, res) => {
  const parent = readParent(req.query as Record<string, unknown>)
  if (!parent) return res.status(400).json({ error: 'exactly_one_parent_required' })

  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c
      .query(
        `${SELECT} where d.${PARENTS[parent.key].column} = $1 and d.deleted_at is null order by d.created_at desc`,
        [parent.id]
      )
      .then((r) => r.rows)
  )
  res.json(rows)
})

documentsRouter.post('/documents', documentUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing_file' })

  // multipart fields arrive as strings, so the parent id and metadata come off
  // req.body alongside the file.
  const parent = readParent(req.body as Record<string, unknown>)
  if (!parent) return res.status(400).json({ error: 'exactly_one_parent_required' })

  if (!can(req.claims?.role_key, PARENTS[parent.key].capability)) {
    return res.status(403).json({ error: 'forbidden' })
  }

  const meta = z
    .object({ kind: z.enum(KINDS).default('other'), description: z.string().max(500).optional() })
    .safeParse({ kind: req.body.kind || undefined, description: req.body.description || undefined })
  if (!meta.success) return res.status(400).json({ error: 'invalid_request' })

  // Relative to FILES_DIR/{org_id}/, matching what filesRouter serves.
  const storagePath = `documents/${req.file.filename}`

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.documents
         (org_id, ${PARENTS[parent.key].column}, kind, file_name, storage_path, content_type, size_bytes, description, uploaded_by)
       values (current_org_id(), $1, $2, $3, $4, $5, $6, $7, $8)
       returning id, org_id`,
      [
        parent.id,
        meta.data.kind,
        req.file!.originalname,
        storagePath,
        req.file!.mimetype,
        req.file!.size,
        meta.data.description ?? null,
        req.claims!.sub,
      ]
    )
    const doc = rows[0]
    await writeAuditLog(c, {
      orgId: doc.org_id,
      actorId: req.claims!.sub,
      action: 'document.upload',
      entityType: 'document',
      entityId: doc.id,
      after: { kind: meta.data.kind, file_name: req.file!.originalname, [parent.key]: parent.id },
    })
    const { rows: full } = await c.query(`${SELECT} where d.id = $1`, [doc.id])
    return full[0]
  })
  res.status(201).json(row)
})

documentsRouter.patch('/documents/:id', async (req, res) => {
  const parsed = z
    .object({ kind: z.enum(KINDS).optional(), description: z.string().max(500).nullable().optional() })
    .safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `update public.documents
          set kind = coalesce($2, kind), description = coalesce($3, description)
        where id = $1 and deleted_at is null
        returning id`,
      [req.params.id, parsed.data.kind ?? null, parsed.data.description ?? null]
    )
    if (!rows[0]) return null
    const { rows: full } = await c.query(`${SELECT} where d.id = $1`, [req.params.id])
    return full[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

// Soft delete only. The file itself stays on disk — an on-prem box is not the
// place to make deletions unrecoverable without an explicit purge step.
documentsRouter.delete('/documents/:id', async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'update public.documents set deleted_at = now() where id = $1 and deleted_at is null returning id, org_id, file_name',
      [req.params.id]
    )
    const doc = rows[0]
    if (doc) {
      await writeAuditLog(c, {
        orgId: doc.org_id,
        actorId: req.claims!.sub,
        action: 'document.delete',
        entityType: 'document',
        entityId: doc.id,
        before: { file_name: doc.file_name },
      })
    }
    return doc
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})
