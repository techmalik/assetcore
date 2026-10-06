import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../../db.js'
import { claimsFromReq } from '../../claims.js'
import { requireCap } from '../../middleware/rbac.js'
import { buildSet } from '../../sqlUtil.js'
import { parseOr400 } from '../../http/validate.js'
import { auditFromReq } from '../../audit.js'

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
  const input = parseOr400(taskInput, req.body, res)
  if (!input) return

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    // Append to the end unless the caller places it explicitly.
    const sequence = input.sequence ?? (await c.query(
      'select coalesce(max(sequence), -1) + 1 as next from public.work_order_tasks where work_order_id = $1',
      [req.params.id]
    )).rows[0].next
    const { rows } = await c.query(
      `insert into public.work_order_tasks (org_id, work_order_id, sequence, description, notes)
       values (current_org_id(), $1, $2, $3, $4) returning *`,
      [req.params.id, sequence, input.description, input.notes ?? null]
    )
    await auditFromReq(c, req, {
      action: 'wo.task.add', entityType: 'work_order', entityId: String(req.params.id),
      after: { task_id: rows[0].id, description: rows[0].description },
    })
    return rows[0]
  })
  res.status(201).json(row)
})

tasksRouter.patch('/work-orders/:id/tasks/:taskId', requireCap('wo:update'), async (req, res) => {
  const input = parseOr400(z.object({
    done: z.boolean().optional(),
    description: z.string().min(1).max(500).optional(),
    notes: z.string().max(500).nullable().optional(),
    sequence: z.number().int().nonnegative().optional(),
  }), req.body, res)
  if (!input) return

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows: before } = await c.query(
      'select description, notes, sequence, done from public.work_order_tasks where id = $1 and work_order_id = $2',
      [req.params.taskId, req.params.id]
    )
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
      [req.params.taskId, req.params.id, input.description ?? null, input.notes ?? null,
       input.sequence ?? null, input.done ?? null]
    )
    if (rows[0]) {
      await auditFromReq(c, req, {
        action: 'wo.task.update', entityType: 'work_order', entityId: String(req.params.id),
        before: { task_id: rows[0].id, ...before[0] }, after: { task_id: rows[0].id, ...input },
      })
    }
    return rows[0] ?? null
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.json(row)
})

tasksRouter.delete('/work-orders/:id/tasks/:taskId', requireCap('wo:update'), async (req, res) => {
  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      'delete from public.work_order_tasks where id = $1 and work_order_id = $2 returning id, description',
      [req.params.taskId, req.params.id]
    )
    if (rows[0]) {
      await auditFromReq(c, req, {
        action: 'wo.task.delete', entityType: 'work_order', entityId: String(req.params.id),
        before: { task_id: rows[0].id, description: rows[0].description },
      })
    }
    return rows[0]
  })
  if (!row) return res.status(404).json({ error: 'not_found' })
  res.status(204).end()
})
