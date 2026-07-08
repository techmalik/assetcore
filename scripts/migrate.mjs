#!/usr/bin/env node
// Applies db/migrations/*.sql in order, recording each in public.schema_migrations.
// Connects as the owner role (DATABASE_URL_OWNER) — migrations create/alter
// tables, roles and RLS policies, which the non-owner assetcore_app role can't do.
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from 'pg'
import dotenv from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const migrationsDir = path.join(root, 'db', 'migrations')

dotenv.config({ path: path.join(root, 'apps', 'api', '.env') })

const connectionString = process.env.DATABASE_URL_OWNER
if (!connectionString) {
  console.error('DATABASE_URL_OWNER is not set (checked process env + apps/api/.env via dotenv).')
  process.exit(1)
}

const client = new pg.Client({ connectionString })

async function main() {
  await client.connect()
  await client.query(`
    create table if not exists public.schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    );
  `)

  const applied = new Set(
    (await client.query('select version from public.schema_migrations')).rows.map((r) => r.version)
  )

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file} (already applied)`)
      continue
    }
    const sql = readFileSync(path.join(migrationsDir, file), 'utf8')
    console.log(`apply ${file}`)
    await client.query('begin')
    try {
      await client.query(sql)
      await client.query('insert into public.schema_migrations (version) values ($1)', [file])
      await client.query('commit')
    } catch (err) {
      await client.query('rollback')
      console.error(`failed ${file}:`, err.message)
      throw err
    }
  }

  console.log('migrations up to date.')
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => client.end())
