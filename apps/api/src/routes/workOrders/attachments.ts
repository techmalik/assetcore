import { Router } from 'express'
import { z } from 'zod'
import { withOrgContext } from '../../db.js'
import { claimsFromReq } from '../../claims.js'
import { requireCap } from '../../middleware/rbac.js'
import { writeAuditLog } from '../../audit.js'
import { uploadRoute, DOCUMENT_MIME_TYPES } from '../../files.js'
import { notifyUsers } from '../../notify.js'
import { parseOr400 } from '../../http/validate.js'

export const attachmentsRouter = Router()

attachmentsRouter.post('/work-orders/:id/attachments', requireCap('wo:update'), ...uploadRoute({ subdir: 'attachments', field: 'file', mime: DOCUMENT_MIME_TYPES }, async (req, res, file) => {
  const url = file.url

  const row = await withOrgContext(claimsFromReq(req), async (c) => {
    const { rows } = await c.query(
      `insert into public.work_order_activity (org_id, work_order_id, user_id, kind, body, attachments)
       values (current_org_id(), $1, current_user_id(), 'attachment', $2, $3::jsonb)
       returning *`,
      [req.params.id, file.name, JSON.stringify([{ url, name: file.name, size: file.size }])]
    )
    const activity = rows[0]
    await writeAuditLog(c, { orgId: activity.org_id, actorId: req.claims!.sub, action: 'work_order.attachment.add', entityType: 'work_order', entityId: activity.work_order_id, after: { url, name: file.name, size: file.size } })

    // PM tasks, inspections and maintenance completions all announce a
    // report upload; work orders were the one attachment path that silently
    // did nothing. Goes to the assignee and the raiser — whoever isn't the
    // uploader is the one waiting to see it.
    const { rows: woRows } = await c.query(
      'select id, org_id, ref, assignee_id, created_by from public.work_orders where id = $1',
      [req.params.id]
    )
    const wo = woRows[0]
    if (wo) {
      await notifyUsers(c, {
        orgId: wo.org_id,
        userIds: [wo.assignee_id, wo.created_by],
        actorId: req.claims!.sub,
        kind: 'report_uploaded',
        title: `File attached to ${wo.ref}`,
        body: file.name,
        entityType: 'work_order',
        entityId: wo.id,
      })
    }
    return activity
  })
  res.status(201).json(row)
}))

const commentInput = z.object({ body: z.string().min(1) })

attachmentsRouter.post('/work-orders/:id/comments', requireCap('wo:update'), async (req, res) => {
  const input = parseOr400(commentInput, req.body, res)
  if (!input) return

  const row = await withOrgContext(claimsFromReq(req), (c) =>
    c.query(
      `insert into public.work_order_activity (org_id, work_order_id, user_id, kind, body)
       values (current_org_id(), $1, current_user_id(), 'comment', $2)
       returning *`,
      [req.params.id, input.body]
    ).then((r) => r.rows[0])
  )
  res.status(201).json(row)
})
