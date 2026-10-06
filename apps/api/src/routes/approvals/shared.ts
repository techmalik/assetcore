import type { Request } from 'express'
import { APPROVAL_SELECT, type NoticeCtx } from '../../approvalRouting.js'

// A rule with its levels in signing order.
export const RULE_SELECT = `
  select r.*,
    coalesce((
      select jsonb_agg(jsonb_build_object('level', l.level, 'role_key', l.role_key, 'label', l.label) order by l.level)
      from public.approval_rule_levels l where l.rule_id = r.id
    ), '[]'::jsonb) as levels
  from public.approval_rules r
`

// Shared with workOrders.ts via approvalRouting.ts, which also adds the
// direct-route assignee and the latest history step.
export const SELECT = APPROVAL_SELECT

export const noticeCtx = (req: Request): NoticeCtx => ({
  orgId: req.claims!.org_id as string,
  actorId: req.claims!.sub,
})
