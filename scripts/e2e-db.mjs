#!/usr/bin/env node
// Builds a fresh database for the browser smoke test (e2e/): drops and
// recreates it, applies every migration, then runs the dev seed, which adds
// one user per role. Fresh each run, so a test never sees rows a previous run
// left behind.
//
// E2E_DATABASE_URL_OWNER names the database (default in e2e/env.mjs:
// assetcore_e2e on the local Postgres, the same server the API tests use).
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import pg from 'pg'
import { ownerUrl, apiEnv } from '../e2e/env.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const target = new URL(ownerUrl)
const dbName = target.pathname.slice(1)
if (!/^[a-z0-9_]*e2e[a-z0-9_]*$/.test(dbName)) {
  // This drops the database. Refuse anything not plainly an e2e database.
  console.error(`Refusing to reset "${dbName}": the e2e database name must contain "e2e".`)
  process.exit(1)
}

const admin = new URL(ownerUrl)
admin.pathname = '/postgres'
const client = new pg.Client({ connectionString: admin.toString() })
await client.connect()
await client.query(`drop database if exists "${dbName}" with (force)`)
await client.query(`create database "${dbName}"`)
await client.end()

// The seed ends with the API's health rescore, which loads the API's config.
const env = { ...process.env, ...apiEnv }
execFileSync('node', [path.join(root, 'scripts', 'migrate.mjs')], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] })
execFileSync('node', [path.join(root, 'scripts', 'seed-dev.mjs')], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] })
console.log(`e2e database ready: ${dbName}`)
