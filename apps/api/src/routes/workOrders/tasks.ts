import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../../db.js'
import { claimsFromReq } from '../../claims.js'
import { requireCap } from '../../middleware/rbac.js'
import { writeAuditLog } from '../../audit.js'
import { buildSet } from '../../sqlUtil.js'

export const tasksRouter = Router()

// ── Task checklist ───────────────────────────────────────────────────────────
// The steps a job is actually worked from. 0001 had only a free-text
// description, so there was nothing to tick off and nothing to audit.

const taskInput = z.object({
  description: z.string().min(1).max(500),
  sequence: z.number().int().nonnegative().optional(),
  notes: z.string().max(500).nullable().optional(),
})

tasksRouter.post('/work-orders/:id/tasks', requireCap('wo:update'), async (req, res) => {
  const parsed = taskInput.safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    // Append to the end unless the caller places it explicitly.
    const sequence = parsed.data.sequence ?? (await c.query(
      'select coalesce(max(sequence), -1) + 1 as next from public.work_order_tasks where work_order_id = $1',
      [req.params.id]
    )).rows[0].next
    const { rows } = await c.query(
      `insert into public.work_order_tasks (org_id, work_order_id, sequence, description, notes)
       values (current_org_id(), $1, $2, $3, $4) returning *`,
      [req.params.id, sequence, parsed.data.description, parsed.data.notes ?? null]
    )
    return rows[0]
  })
  res.status(201).json(row)
})

tasksRouter.patch('/work-orders/:id/tasks/:taskId', requireCap('wo:update'), async (req, res) => {
  const parsed = z.object({
    done: z.boolean().optional(),
    description: z.string().min(1).max(500).optional(),
    notes: z.string().max(500).nullable().optional(),
    sequence: z.number().int().nonnegative().optional(),
  }).safeParse(req.body)
  if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    // Ticking a step records who and when; un-ticking clears both, so the
    // record never claims someone completed a step that is now open.
    const { rows } = await c.query(
      `update public.work_order_tasks
          set description = coalesce($3, description),
              notes       = coalesce($4, notes),
              sequence    = coalesce($5, sequence),
              done        = coalesce($6, done),
              done_by     = case when $6 is null then done_by  when $6 then current_user_id() else null end,
              done_at     = case when $6 is null then done_at  when $6 then now()             else null end
        where id = $1 and work_order_id = $2
        returning *`,
      [req.params.taskId, req.params.id, parsed.data.description ?? null, parsed.data.notes ?? null,
       parsed.data.sequence ?? null, parsed.data.done ?? null]
    )
    return rows[0] ?? null
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

tasksRouter.delete('/work-orders/:id/tasks/:taskId', requireCap('wo:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query('delete from public.work_order_tasks where id = $1 and work_order_id = $2 returning id',
      [req.params.taskId, req.params.id]).then((r) => r.rows[0])
  )
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})
