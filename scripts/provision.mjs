#!/usr/bin/env node
// ============================================================================
// PROVISIONING — run on the client's server (after migrate.mjs) to commission
// a fresh AssetCore instance: creates the client org, the owner account, our
// staff/platform-admin accounts, and the licence_info row, driven by
// deploy/instance.config.json (copy from the committed .example).
//
// Idempotent: re-running with an unchanged config touches nothing. An
// existing user's password / must_change_password flag is never touched —
// only newly-created users get a temp password (printed once, here).
// ============================================================================
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import crypto from 'node:crypto'
import pg from 'pg'
import argon2 from 'argon2'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(root, 'apps', 'api', '.env') })

const configPath = process.argv[2] || path.join(root, 'deploy', 'instance.config.json')
if (!existsSync(configPath)) {
  console.error(`Config not found: ${configPath}`)
  console.error('Copy deploy/instance.config.json.example to deploy/instance.config.json and fill it in.')
  process.exit(1)
}
const config = JSON.parse(readFileSync(configPath, 'utf8'))

const connectionString = process.env.DATABASE_URL_OWNER
if (!connectionString) {
  console.error('DATABASE_URL_OWNER is not set (checked process env + apps/api/.env via dotenv).')
  process.exit(1)
}

const client = new pg.Client({ connectionString })

function genTempPassword() {
  return crypto.randomBytes(9).toString('base64url')
}

// Creates the user if missing; never touches an existing user's password or
// must_change_password flag (that would clobber a password they already
// changed). Returns { id, created, tempPassword? }.
async function ensureUser(email, fullName) {
  const { rows: existing } = await client.query('select id from public.users where email = $1', [email])
  if (existing[0]) return { id: existing[0].id, created: false }

  const tempPassword = genTempPassword()
  const passwordHash = await argon2.hash(tempPassword, { type: argon2.argon2id })
  const { rows } = await client.query(
    `insert into public.users (email, password_hash, full_name, must_change_password)
     values ($1, $2, $3, true) returning id`,
    [email, passwordHash, fullName ?? '']
  )
  return { id: rows[0].id, created: true, tempPassword }
}

async function main() {
  await client.connect()
  await client.query('begin')

  const summary = { org: null, owner: null, staff: [], licence: null }

  // --- Organization (single-tenant per instance) ----------------------------
  const { rows: orgRows } = await client.query(
    'select id, name, short_name, industry, region, plan, billing_status from public.organizations where deleted_at is null limit 1'
  )
  let orgId, orgChanged
  if (orgRows[0]) {
    orgId = orgRows[0].id
    orgChanged = orgRows[0].name !== config.org.name
      || (orgRows[0].short_name ?? null) !== (config.org.shortName ?? null)
      || (orgRows[0].industry ?? null) !== (config.org.industry ?? null)
      || (orgRows[0].region ?? null) !== (config.org.region ?? null)
      || orgRows[0].plan !== 'licensed'
      || orgRows[0].billing_status !== 'licensed'
    if (orgChanged) {
      await client.query(
        `update public.organizations
         set name = $2, short_name = $3, industry = $4, region = $5, plan = 'licensed', billing_status = 'licensed'
         where id = $1`,
        [orgId, config.org.name, config.org.shortName ?? null, config.org.industry ?? null, config.org.region ?? null]
      )
    }
  } else {
    const { rows } = await client.query(
      `insert into public.organizations (name, short_name, industry, region, plan, billing_status)
       values ($1, $2, $3, $4, 'licensed', 'licensed') returning id`,
      [config.org.name, config.org.shortName ?? null, config.org.industry ?? null, config.org.region ?? null]
    )
    orgId = rows[0].id
    orgChanged = true
  }
  summary.org = { id: orgId, name: config.org.name, changed: orgChanged }

  // --- Owner user + membership ------------------------------------------------
  const owner = await ensureUser(config.owner.email, config.owner.fullName)
  await client.query(
    `insert into public.memberships (org_id, user_id, role_key, status)
     values ($1, $2, 'owner', 'active')
     on conflict (org_id, user_id) do update set role_key = 'owner', status = 'active'`,
    [orgId, owner.id]
  )
  summary.owner = { email: config.owner.email, created: owner.created, tempPassword: owner.tempPassword }

  // --- Staff users + platform_admins -------------------------------------------
  for (const s of config.staff ?? []) {
    const u = await ensureUser(s.email, s.fullName)
    const { rows: adminRows } = await client.query('select role from public.platform_admins where user_id = $1', [u.id])
    if (!adminRows[0]) {
      await client.query(
        'insert into public.platform_admins (user_id, role, full_name) values ($1, $2, $3)',
        [u.id, s.role, s.fullName ?? '']
      )
    } else if (adminRows[0].role !== s.role) {
      await client.query('update public.platform_admins set role = $2 where user_id = $1', [u.id, s.role])
    }
    summary.staff.push({ email: s.email, role: s.role, created: u.created, tempPassword: u.tempPassword })
  }

  // --- Licence -------------------------------------------------------------------
  const lic = config.licence
  const desired = {
    licensed_to: lic.licensedTo,
    contract_ref: lic.contractRef ?? null,
    issued_at: lic.issuedAt ?? null,
    expires_at: lic.expiresAt ?? null,
    maintenance_expires_at: lic.maintenanceExpiresAt ?? null,
    annual_fee_cents: lic.annualFeeCents ?? null,
    currency: lic.currency ?? 'NGN',
    seats: lic.seats ?? null,
    notes: lic.notes ?? null,
  }
  const { rows: licRows } = await client.query(
    `select id, licensed_to, contract_ref, issued_at::text, expires_at::text, maintenance_expires_at::text,
            annual_fee_cents, currency, seats, notes
     from public.licence_info limit 1`
  )
  // annual_fee_cents is bigint — pg returns it as a string to avoid precision
  // loss, so normalize both sides to string before comparing.
  const normalize = (k, v) => (k === 'annual_fee_cents' && v != null ? String(v) : v)

  let licChanged
  if (licRows[0]) {
    licChanged = Object.keys(desired).some((k) => normalize(k, licRows[0][k] ?? null) !== normalize(k, desired[k] ?? null))
    if (licChanged) {
      await client.query(
        `update public.licence_info set
           licensed_to = $1, contract_ref = $2, issued_at = $3, expires_at = $4, maintenance_expires_at = $5,
           annual_fee_cents = $6, currency = $7, seats = $8, notes = $9
         where id = $10`,
        [desired.licensed_to, desired.contract_ref, desired.issued_at, desired.expires_at,
          desired.maintenance_expires_at, desired.annual_fee_cents, desired.currency, desired.seats, desired.notes,
          licRows[0].id]
      )
    }
  } else {
    await client.query(
      `insert into public.licence_info
         (licensed_to, contract_ref, issued_at, expires_at, maintenance_expires_at, annual_fee_cents, currency, seats, notes)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [desired.licensed_to, desired.contract_ref, desired.issued_at, desired.expires_at,
        desired.maintenance_expires_at, desired.annual_fee_cents, desired.currency, desired.seats, desired.notes]
    )
    licChanged = true
  }
  summary.licence = { licensedTo: lic.licensedTo, changed: licChanged }

  await client.query('commit')

  console.log('='.repeat(78))
  console.log('AssetCore — commissioning summary')
  console.log('='.repeat(78))
  console.log(`Organization: ${summary.org.name} (${summary.org.id}) ${summary.org.changed ? '— updated' : '— unchanged'}`)
  console.log(`Owner:        ${summary.owner.email} ${summary.owner.created ? '— created' : '— already exists'}`)
  if (summary.owner.tempPassword) console.log(`  Temp password (must change on first login): ${summary.owner.tempPassword}`)
  for (const s of summary.staff) {
    console.log(`Staff:        ${s.email} (${s.role}) ${s.created ? '— created' : '— already exists'}`)
    if (s.tempPassword) console.log(`  Temp password (must change on first login): ${s.tempPassword}`)
  }
  console.log(`Licence:      ${summary.licence.licensedTo} ${summary.licence.changed ? '— updated' : '— unchanged'}`)
  console.log('='.repeat(78))
}

main()
  .catch(async (err) => {
    await client.query('rollback').catch(() => {})
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => client.end())
