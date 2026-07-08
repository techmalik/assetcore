import { Router } from 'express'
import { ownerPool } from '../../db.js'
import { requirePlatformCap } from '../../middleware/platformRbac.js'

export const metricsRouter = Router()

metricsRouter.get('/metrics', requirePlatformCap('org:read'), async (_req, res) => {
  const [{ rows: orgs }, { rows: invoices }, assets, woTotal, woOpen, members] = await Promise.all([
    ownerPool.query('select id, plan, billing_status, deleted_at, created_at from public.organizations'),
    ownerPool.query('select amount_cents, status from public.billing_invoices'),
    ownerPool.query('select count(*)::int as c from public.assets where deleted_at is null').then((r) => r.rows[0].c),
    ownerPool.query('select count(*)::int as c from public.work_orders where deleted_at is null').then((r) => r.rows[0].c),
    ownerPool.query("select count(*)::int as c from public.work_orders where deleted_at is null and status <> 'closed'").then((r) => r.rows[0].c),
    ownerPool.query("select count(*)::int as c from public.memberships where status = 'active'").then((r) => r.rows[0].c),
  ])

  const live = orgs.filter((o) => !o.deleted_at)
  const byPlan: Record<string, number> = {}
  const byBilling: Record<string, number> = {}
  for (const o of live) {
    byPlan[o.plan] = (byPlan[o.plan] ?? 0) + 1
    byBilling[o.billing_status] = (byBilling[o.billing_status] ?? 0) + 1
  }
  const since = Date.now() - 30 * 864e5
  const newOrgs30d = live.filter((o) => new Date(o.created_at).getTime() >= since).length

  const sum = (pred: (s: string) => boolean) =>
    invoices.filter((i) => pred(i.status)).reduce((a, i) => a + Number(i.amount_cents ?? 0), 0)

  res.json({
    orgs: { total: live.length, suspended: orgs.length - live.length, new30d: newOrgs30d, byPlan, byBilling },
    users: members,
    assets,
    workOrders: { total: woTotal, open: woOpen },
    billing: {
      collectedCents: sum((s) => s === 'paid'),
      outstandingCents: sum((s) => s === 'sent' || s === 'overdue'),
    },
  })
})
