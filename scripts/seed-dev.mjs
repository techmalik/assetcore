#!/usr/bin/env node
// ============================================================================
// DEV-ONLY DEMO SEED — do not run against a client instance. Real client
// commissioning happens via scripts/provision.mjs (Phase 3).
//
// Demo data (NGML org, demo owner, demo platform admin, sample
// assets/WOs/licences/inspections/devices) — originally ported from the
// pre-pivot Supabase-era seed.sql, now the only seed script (supabase/
// removed in Phase 8). Connects via DATABASE_URL_OWNER (bypasses RLS) —
// same role migrate.mjs uses.
//
// DEMO OWNER LOGIN  → email: a.okeke@ngml.example   password: Password123!
// DEMO ADMIN LOGIN  → email: admin@assetcore.io      password: Password123!
// ============================================================================
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from 'pg'
import argon2 from 'argon2'
import dotenv from 'dotenv'

console.log('='.repeat(78))
console.log('DEV SEED — demo data only. Never run this against a client instance.')
console.log('='.repeat(78))

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(root, 'apps', 'api', '.env') })

const connectionString = process.env.DATABASE_URL_OWNER
if (!connectionString) {
  console.error('DATABASE_URL_OWNER is not set (checked process env + apps/api/.env via dotenv).')
  process.exit(1)
}

const ORG = '11111111-1111-1111-1111-111111111111'
const OWNER = '22222222-2222-2222-2222-222222222222'
const ADMIN = '33333333-3333-3333-3333-333333333333'

const client = new pg.Client({ connectionString })

async function main() {
  await client.connect()
  const ownerHash = await argon2.hash('Password123!')
  const adminHash = await argon2.hash('Password123!')

  await client.query('begin')

  await client.query(
    `insert into public.users (id, email, password_hash, full_name, status)
     values ($1, $2, $3, $4, 'active')
     on conflict (id) do nothing`,
    [OWNER, 'a.okeke@ngml.example', ownerHash, 'Adaeze Okeke']
  )
  await client.query(
    `insert into public.users (id, email, password_hash, full_name, status)
     values ($1, $2, $3, $4, 'active')
     on conflict (id) do nothing`,
    [ADMIN, 'admin@assetcore.io', adminHash, 'Malik Kabir']
  )

  await client.query(
    `insert into public.organizations (id, name, short_name, industry, region, plan, billing_status)
     values ($1, 'Nigeria Gas Marketing Limited', 'NGML', 'Oil & Gas Distribution', 'Nigeria', 'licensed', 'licensed')
     on conflict (id) do nothing`,
    [ORG]
  )

  await client.query(
    `insert into public.memberships (org_id, user_id, role_key, status)
     values ($1, $2, 'owner', 'active')
     on conflict (org_id, user_id) do nothing`,
    [ORG, OWNER]
  )

  await client.query(
    `insert into public.platform_admins (user_id, role, full_name, status)
     values ($1, 'superadmin', 'Malik Kabir', 'active')
     on conflict (user_id) do nothing`,
    [ADMIN]
  )

  const sites = [
    ['a0000000-0000-0000-0000-000000000001', 'Lagos DS-04', 'LAG-DS04', 'Lagos', 6.45, 3.4],
    ['a0000000-0000-0000-0000-000000000002', 'Delta CS', 'DEL-CS', 'Delta', 5.55, 5.79],
    ['a0000000-0000-0000-0000-000000000003', 'North Benin', 'NTH-BEN', 'Edo', 6.34, 5.62],
    ['a0000000-0000-0000-0000-000000000004', 'Warri Terminal A', 'WAR-TA', 'Delta', 5.52, 5.75],
    ['a0000000-0000-0000-0000-000000000005', 'Aba Network', 'ABA-NET', 'Abia', 5.11, 7.37],
  ]
  for (const [id, name, code, region, lat, lng] of sites) {
    await client.query(
      `insert into public.sites (id, org_id, name, code, region, lat, lng)
       values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing`,
      [id, ORG, name, code, region, lat, lng]
    )
  }

  const categories = [
    ['c0000000-0000-0000-0000-000000000001', 'Metering Station', 'MTR'],
    ['c0000000-0000-0000-0000-000000000002', 'Compressor', 'CMP'],
    ['c0000000-0000-0000-0000-000000000003', 'Pressure Regulator', 'REG'],
    ['c0000000-0000-0000-0000-000000000004', 'Valve', 'VLV'],
    ['c0000000-0000-0000-0000-000000000005', 'Pipeline', 'PIP'],
    ['c0000000-0000-0000-0000-000000000006', 'SCADA / RTU', 'SCR'],
    ['c0000000-0000-0000-0000-000000000007', 'ESD Valve', 'ESD'],
  ]
  for (const [id, name, code] of categories) {
    await client.query(
      `insert into public.asset_categories (id, org_id, name, code)
       values ($1, $2, $3, $4) on conflict (id) do nothing`,
      [id, ORG, name, code]
    )
  }

  const assets = [
    ['a0000000-0000-0000-0000-000000000001', 'NGML-MTR-0042', 'Lagos DS-04 Metering Station', 'c0000000-0000-0000-0000-000000000001', 'critical', 32, 19540000000],
    ['a0000000-0000-0000-0000-000000000002', 'NGML-CMP-0017', 'Delta Compression Station C-017', 'c0000000-0000-0000-0000-000000000002', 'attention', 61, 84020000000],
    ['a0000000-0000-0000-0000-000000000003', 'NGML-REG-0089', 'North Benin PRG-089', 'c0000000-0000-0000-0000-000000000003', 'attention', 74, 2410000000],
    ['a0000000-0000-0000-0000-000000000004', 'NGML-VLV-0089', 'Warri T-A Isolation Valve 089', 'c0000000-0000-0000-0000-000000000004', 'operational', 88, 870000000],
    ['a0000000-0000-0000-0000-000000000005', 'NGML-PIP-0312', 'Aba DN200 Pipeline Segment 312', 'c0000000-0000-0000-0000-000000000005', 'operational', 92, 120000000000],
    ['a0000000-0000-0000-0000-000000000004', 'NGML-SCR-041', 'Warri Terminal A RTU', 'c0000000-0000-0000-0000-000000000006', 'critical', 18, 1230000000],
  ]
  for (const [siteId, ain, name, categoryId, status, health, nbv] of assets) {
    await client.query(
      `insert into public.assets (org_id, site_id, ain, name, category_id, status, health_score, nbv_cents)
       values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (org_id, ain) do nothing`,
      [ORG, siteId, ain, name, categoryId, status, health, nbv]
    )
  }

  const workOrders = [
    ['b1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'NGML-MTR-0042', 'WO-2025-0041', 'Pressure sensor calibration — MTR-0042', 'Inlet pressure reading deviating by >5%. Sensor requires recalibration or replacement.', 'corrective', 'in_progress', 'critical', 2],
    ['b1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000004', 'NGML-SCR-041', 'WO-2025-0042', 'SCADA RTU comms failure — Warri A', 'RTU lost communication with SCADA host. No telemetry for 47 minutes. Field inspection required.', 'emergency', 'assigned', 'critical', 1],
    ['b1000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000002', 'NGML-CMP-0017', 'WO-2025-0039', 'Quarterly service — CMP-0017', 'Scheduled quarterly preventive maintenance. Lubrication, filter change, belt inspection.', 'preventive', 'new', 'medium', 7],
    ['b1000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000003', 'NGML-REG-0089', 'WO-2025-0038', 'PRG-089 outlet pressure variance', 'Outlet pressure 0.8 bar above set point. Possible seat wear. Inspect and adjust.', 'corrective', 'awaiting_parts', 'high', 3],
    ['b1000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'NGML-MTR-0042', 'WO-2025-0035', 'Annual NMDPRA inspection — MTR-0042', 'Regulatory inspection per NMDPRA directive. Prepare calibration certificates and maintenance logs.', 'inspection', 'inspection', 'high', 5],
  ]
  for (const [id, siteId, ain, ref, title, description, type, status, priority, dueInDays] of workOrders) {
    await client.query(
      `insert into public.work_orders (id, org_id, site_id, asset_id, ref, title, description, type, status, priority, created_by, sla_due)
       values ($1, $2, $3, (select id from public.assets where ain = $4 and org_id = $2), $5, $6, $7, $8, $9, $10, $11, now() + ($12 || ' days')::interval)
       on conflict (id) do nothing`,
      [id, ORG, siteId, ain, ref, title, description, type, status, priority, OWNER, dueInDays]
    )
  }

  const licences = [
    ['d1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Operating Licence — Lagos DS-04', 'NMDPRA/OL/2024/LAG-DS04', '2024-01-15', '2026-01-14', 'NMDPRA', null],
    ['d1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'Environmental Permit — Delta CS', 'NESREA/EP/2023/DEL-CS', '2023-03-01', '2026-02-28', 'NESREA', null],
    ['d1000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000004', 'Fire Safety Certificate — Warri Terminal A', 'NSCDC/FSC/2024/WAR-TA', '2024-08-05', '2099-01-01', 'NSCDC', null],
    ['d1000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000001', 'Metering Certification — MTR-0042', 'NMI/MC/2024/MTR0042', '2024-01-14', '2025-07-13', 'NMI', null],
    ['d1000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000005', 'Pipeline Operating Certificate — PIP-0312', 'NMDPRA/POC/2023/PIP0312', '2023-02-02', '2026-02-01', 'NMDPRA', null],
    ['d1000000-0000-0000-0000-000000000007', 'a0000000-0000-0000-0000-000000000001', 'ESD System Certificate — Lagos', 'NSC/ESD/2024/LAG001', '2024-06-20', '2026-06-19', 'NSC', null],
  ]
  for (const [id, siteId, name, licenceNumber, issued, expiry, authorityCode, notes] of licences) {
    await client.query(
      `insert into public.compliance_licences (id, org_id, site_id, name, licence_number, issued_date, expiry_date, authority_id, notes)
       values ($1, $2, $3, $4, $5, $6, $7, (select id from public.regulatory_authorities where code = $8), $9)
       on conflict (id) do nothing`,
      [id, ORG, siteId, name, licenceNumber, issued, expiry, authorityCode, notes]
    )
  }
  // NSC/PVC — expired 5 days ago; NSCDC/FSC — due in 6 days. current_date is
  // computed server-side so these stay relative to "today" on every re-seed.
  await client.query(
    `insert into public.compliance_licences (id, org_id, site_id, name, licence_number, issued_date, expiry_date, authority_id, notes)
     values ('d1000000-0000-0000-0000-000000000003', $1, 'a0000000-0000-0000-0000-000000000002',
       'Pressure Vessel Certificate — CMP-0017', 'NSC/PVC/2024/CMP0017', '2024-10-10',
       current_date - interval '5 days', (select id from public.regulatory_authorities where code = 'NSC'),
       'EXPIRED — renewal urgent')
     on conflict (id) do nothing`,
    [ORG]
  )
  await client.query(
    `update public.compliance_licences set expiry_date = current_date + interval '6 days'
     where id = 'd1000000-0000-0000-0000-000000000004'`
  )

  const inspections = [
    ['e1000000-0000-0000-0000-000000000001', 'NGML-MTR-0042', 'a0000000-0000-0000-0000-000000000001', 'Lagos DS-04 — Inlet Calibration Inspection', 'safety', 'due', 0],
    ['e1000000-0000-0000-0000-000000000002', 'NGML-CMP-0017', 'a0000000-0000-0000-0000-000000000002', 'CMP-0017 Condition Assessment', 'condition', 'scheduled', 1],
  ]
  for (const [id, ain, siteId, title, kind, status, dueInDays] of inspections) {
    await client.query(
      `insert into public.inspections (id, org_id, asset_id, site_id, title, kind, status, inspector_id, scheduled_date)
       values ($1, $2, (select id from public.assets where ain = $3 and org_id = $2), $4, $5, $6, $7, $8, current_date + ($9 || ' days')::interval)
       on conflict (id) do nothing`,
      [id, ORG, ain, siteId, title, kind, status, OWNER, dueInDays]
    )
  }
  await client.query(
    `insert into public.inspections (id, org_id, asset_id, site_id, title, kind, status, inspector_id, scheduled_date, completed_date, findings)
     values ('e1000000-0000-0000-0000-000000000003', $1,
       (select id from public.assets where ain = 'NGML-PIP-0312' and org_id = $1),
       'a0000000-0000-0000-0000-000000000005', 'Aba DN200 Pipeline Integrity Check', 'integrity', 'completed', $2,
       current_date - interval '4 days', current_date - interval '4 days',
       'No corrosion detected. Cathodic protection reading nominal at -0.85V. Coating intact.')
     on conflict (id) do nothing`,
    [ORG, OWNER]
  )

  const devices = [
    ['f1000000-0000-0000-0000-000000000001', 'NGML-MTR-0042', 'LAG-DS04', 'TRM-FLW-001', 'Lagos DS-04 Flow Transmitter', 'meter', 'modbus', 'online', 'v2.3.1', '192.168.10.21'],
    ['f1000000-0000-0000-0000-000000000002', 'NGML-CMP-0017', 'DEL-CS', 'SEN-PRS-007', 'Delta CS Pressure Sensor', 'sensor', 'mqtt', 'unprovisioned', null, null],
  ]
  for (const [id, ain, siteCode, serial, name, kind, protocol, status, firmware, ip] of devices) {
    await client.query(
      `insert into public.devices (id, org_id, asset_id, site_id, serial_number, name, kind, protocol, status, firmware_version, ip_address)
       values ($1, $2, (select id from public.assets where org_id = $2 and ain = $3), (select id from public.sites where org_id = $2 and code = $4), $5, $6, $7, $8, $9, $10, $11)
       on conflict (id) do nothing`,
      [id, ORG, ain, siteCode, serial, name, kind, protocol, status, firmware, ip]
    )
  }
  await client.query(
    `insert into public.devices (id, org_id, asset_id, site_id, serial_number, name, kind, protocol, status, firmware_version, ip_address)
     values ('f1000000-0000-0000-0000-000000000003', $1, null,
       (select id from public.sites where org_id = $1 and code = 'WAR-TA'),
       'GW-WAR-001', 'Warri Terminal Gateway', 'gateway', 'mqtt', 'offline', 'v1.8.0', '10.0.1.5')
     on conflict (id) do nothing`,
    [ORG]
  )
  await client.query(
    `update public.devices set last_seen_at = now() - interval '4 minutes' where id = 'f1000000-0000-0000-0000-000000000001'`
  )
  await client.query(
    `update public.devices set last_seen_at = now() - interval '3 days' where id = 'f1000000-0000-0000-0000-000000000003'`
  )

  await client.query('commit')

  console.log('Seed complete.')
  console.log(`  Owner login: a.okeke@ngml.example / Password123!`)
  console.log(`  Admin login: admin@assetcore.io / Password123!`)
}

main()
  .catch(async (err) => {
    await client.query('rollback').catch(() => {})
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => client.end())
