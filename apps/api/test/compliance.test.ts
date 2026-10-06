import { describe, expect, it } from 'vitest'
import { ownerClient, USERS, ASSET_A1, SITE_A1 } from './fixtures.js'
import { apiAs } from './helpers.js'

describe('archiving a compliance audit', () => {
  // DELETE /compliance-audits/:id used to be registered twice. Express ran the
  // first copy, which had no `deleted_at is null` guard, so archiving an audit
  // a second time answered 204, moved deleted_at and wrote a second audit row.
  it('archives once; a second archive answers 404 and writes nothing', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const created = await api.post('/api/compliance-audits').send({
      title: `TEST archive-once ${Date.now()}`, audit_date: '2026-01-01', site_id: null,
    })
    expect(created.status).toBe(201)
    const id = created.body.id as string

    expect((await api.delete(`/api/compliance-audits/${id}`)).status).toBe(204)
    expect((await api.delete(`/api/compliance-audits/${id}`)).status).toBe(404)

    const client = ownerClient()
    await client.connect()
    try {
      const { rows } = await client.query(
        `select count(*)::int as n from public.audit_log
         where action = 'compliance_audit.archive' and entity_id = $1`,
        [id]
      )
      expect(rows[0].n).toBe(1)
    } finally {
      await client.end()
    }
  })
})

describe('raising a defect from an audit finding', () => {
  // It used to insert the defect by hand: no defect.create audit row and no
  // health refresh for the asset, both of which POST /defects does.
  it('creates the same defect POST /defects would, and rescores the asset', async () => {
    const api = await apiAs(USERS.ownerA.email)
    const db = ownerClient()
    await db.connect()
    try {
      const tag = Date.now()
      const audit = await api.post('/api/compliance-audits').send({ title: `TEST finding ${tag}`, audit_date: '2026-01-01', site_id: SITE_A1 })
      expect(audit.status).toBe(201)
      const finding = await api.post(`/api/compliance-audits/${audit.body.id}/findings`).send({
        clause: '7.1', description: `Earthing not tested ${tag}`, severity: 'major', due_date: '2026-12-31',
      })
      expect(finding.status).toBe(201)

      const before = await db.query('select health_score_computed_at from public.assets where id = $1', [ASSET_A1])
      const raised = await api.post(`/api/compliance-audits/${audit.body.id}/findings/${finding.body.id}/defect`).send({ asset_id: ASSET_A1 })
      expect(raised.status).toBe(201)
      const after = await db.query('select health_score_computed_at from public.assets where id = $1', [ASSET_A1])
      expect(after.rows[0].health_score_computed_at).not.toEqual(before.rows[0].health_score_computed_at)

      const direct = await api.post('/api/defects').send({
        title: `${audit.body.ref} 7.1: audit finding`, description: `Earthing not tested ${tag}`, severity: 'major',
        category: 'compliance', asset_id: ASSET_A1, site_id: SITE_A1, due_date: '2026-12-31',
      })
      expect(direct.status).toBe(201)

      const cols = 'org_id, reported_by, title, description, severity, status, category, asset_id, site_id, inspection_id, assigned_to, identified_date, due_date, work_order_id'
      const { rows: [fromFinding] } = await db.query(`select ${cols} from public.defects where id = $1`, [raised.body.id])
      const { rows: [fromPost] } = await db.query(`select ${cols} from public.defects where id = $1`, [direct.body.id])
      expect(fromFinding).toEqual(fromPost)

      const { rows: logged } = await db.query(
        "select 1 from public.audit_log where action = 'defect.create' and entity_id = $1", [raised.body.id]
      )
      expect(logged).toHaveLength(1)
    } finally {
      await db.end()
    }
  })
})
