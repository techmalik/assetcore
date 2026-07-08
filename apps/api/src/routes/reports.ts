import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../db.js'
import { claimsFromReq } from '../claims.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireCap } from '../middleware/rbac.js'

export const reportsRouter = Router()
reportsRouter.use(requireAuth, requireOrg)

const SELECT = `
  select r.*,
    case when u.id is null then null else jsonb_build_object('full_name', u.full_name) end as created_by_profile
  from public.reports r
  left join public.users u on u.id = r.created_by
`

reportsRouter.get('/reports', async (req, res) => {
  const limit = Number(req.query.limit) || 50
  const rows = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(`${SELECT} order by r.created_at desc limit $1`, [limit]).then((r) => r.rows)
  )
  res.json(rows)
})

const requestInput = z.object({
  title: z.string().min(1),
  kind: z.string().min(1),
  format: z.enum(['csv', 'xlsx']).default('xlsx'),
  params: z.record(z.unknown()).optional(),
})

reportsRouter.post('/reports', requireCap('report:create'), async (req, res) => {
  const parsed = requestInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })
  const { title, kind, format, params } = parsed.data

  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `insert into public.reports (org_id, title, kind, format, params, status, created_by)
       values (current_org_id(), $1, $2, $3, $4, 'pending', current_user_id())
       returning *`,
      [title, kind, format, params ?? {}]
    ).then((r) => r.rows[0])
  )
  res.status(201).json(row)
})

// Mechanical port of the old `simulateReportReady` fake-completion stub.
// Phase 6 replaces this with real server-side generation via exceljs.
reportsRouter.post('/reports/:id/simulate-ready', requireCap('report:create'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `update public.reports set status = 'ready', completed_at = now(),
         storage_path = 'reports/' || $1 || '.' || format,
         file_size_bytes = floor(random() * 3000000 + 500000)
       where id = $1 returning *`,
      [req.params.id]
    ).then((r) => r.rows[0])
  )
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})
