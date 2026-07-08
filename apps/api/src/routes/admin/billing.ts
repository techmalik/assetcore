import { Router } from 'express'
import { ownerPool } from '../../db.js'
import { requirePlatformCap } from '../../middleware/platformRbac.js'
import { writePlatformAuditLog } from '../../audit.js'
import { buildSet } from '../../sqlUtil.js'

export const billingRouter = Router()

const ALLOWED = ['amount_cents', 'status', 'po_number', 'period_start', 'period_end', 'due_at', 'notes']

billingRouter.get('/billing/invoices', requirePlatformCap('billing:read'), async (req, res) => {
  const orgId = typeof req.query.org_id === 'string' ? req.query.org_id : null
  const { rows } = await ownerPool.query(
    `select bi.*, jsonb_build_object('name', o.name, 'short_name', o.short_name) as organizations
     from public.billing_invoices bi
     join public.organizations o on o.id = bi.org_id
     ${orgId ? 'where bi.org_id = $1' : ''}
     order by bi.created_at desc`,
    orgId ? [orgId] : []
  )
  res.json({ invoices: rows })
})

billingRouter.post('/billing/invoices', requirePlatformCap('billing:write'), async (req, res) => {
  const body = req.body ?? {}
  if (!body.org_id || !body.number) return res.status(400).json({ error: 'org_id and number are required' })
  const { rows } = await ownerPool.query(
    `insert into public.billing_invoices
       (org_id, number, amount_cents, currency, status, po_number, period_start, period_end, due_at, notes, created_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning *`,
    [body.org_id, body.number, body.amount_cents ?? 0, body.currency ?? 'NGN', body.status ?? 'draft',
      body.po_number ?? null, body.period_start ?? null, body.period_end ?? null, body.due_at ?? null,
      body.notes ?? null, req.claims!.sub]
  )
  const invoice = rows[0]
  await writePlatformAuditLog({ actorId: req.claims!.sub, action: 'invoice.create', targetType: 'invoice', targetId: invoice.id, orgId: invoice.org_id, after: invoice, ip: req.ip })
  res.status(201).json({ invoice })
})

billingRouter.patch('/billing/invoices/:id', requirePlatformCap('billing:write'), async (req, res) => {
  const { rows: beforeRows } = await ownerPool.query('select * from public.billing_invoices where id = $1', [req.params.id])
  const before = beforeRows[0]
  if (!before) return res.status(404).json({ error: 'Invoice not found' })

  const body = req.body ?? {}
  const { setSql, values } = buildSet(body, ALLOWED)
  if (!setSql) return res.status(400).json({ error: 'empty_patch' })

  // Stamp lifecycle timestamps on status transitions, same as the old Edge Function.
  const stampSql = [
    body.status === 'sent' && !before.issued_at ? `, issued_at = now()` : '',
    body.status === 'paid' && !before.paid_at ? `, paid_at = now()` : '',
  ].join('')

  const { rows } = await ownerPool.query(
    `update public.billing_invoices set ${setSql}${stampSql} where id = $1 returning *`,
    [req.params.id, ...values]
  )
  const invoice = rows[0]
  await writePlatformAuditLog({ actorId: req.claims!.sub, action: 'invoice.update', targetType: 'invoice', targetId: invoice.id, orgId: before.org_id, before, after: invoice, ip: req.ip })
  res.json({ invoice })
})
