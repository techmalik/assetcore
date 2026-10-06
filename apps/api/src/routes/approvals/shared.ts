import type { Request } from 'express'
import type { PoolClient } from 'pg'
import { APPROVAL_SELECT, approvalEvents, type NoticeCtx } from '../../approvalRouting.js'

// What can be sent for approval, and for what. 0001 shipped the table with

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

// Events now carry `to_user` as well as `actor`: a forward is only legible if
// it says who it went to.
export async function eventsFor(c: PoolClient, approvalId: string) {
  return approvalEvents(c, approvalId)
}
