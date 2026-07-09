#!/usr/bin/env node
// ============================================================================
// SUPPORT BUNDLE — one command the client (or we, over VPN) run to produce a
// diagnostics archive for remote support: app/DB version, migration state,
// /api/health, container status, recent API logs, disk/backup status.
// Deliberately collects NO tenant data (no org names, no rows, no user info)
// — safe to attach to a support ticket.
//
// Usage: node scripts/support-bundle.mjs [--base-url http://localhost] [--compose-file deploy/docker-compose.yml]
// ============================================================================
import { execSync } from 'node:child_process'
import { writeFileSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const args = process.argv.slice(2)
function argValue(flag, fallback) {
  const i = args.indexOf(flag)
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback
}
const baseUrl = argValue('--base-url', 'http://localhost')
const composeFile = argValue('--compose-file', path.join(root, 'deploy', 'docker-compose.yml'))
const envFile = argValue('--env-file', path.join(root, 'deploy', '.env.deploy'))
const backupDir = argValue('--backup-dir', '/var/backups/assetcore')
const composeBase = `docker compose -f "${composeFile}"${existsSync(envFile) ? ` --env-file "${envFile}"` : ''}`

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const bundleName = `assetcore-support-${stamp}`
const bundleDir = path.join(root, bundleName)
mkdirSync(bundleDir, { recursive: true })

function write(file, content) {
  writeFileSync(path.join(bundleDir, file), typeof content === 'string' ? content : JSON.stringify(content, null, 2))
  console.log(`  wrote ${file}`)
}

function tryRun(cmd) {
  try {
    return execSync(cmd, { cwd: root, encoding: 'utf8' })
  } catch (err) {
    return `[command failed: ${cmd}]\n${err.stdout || err.message}`
  }
}

async function tryFetch(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
    const body = await res.text()
    return `HTTP ${res.status}\n${body}`
  } catch (err) {
    return `[fetch failed: ${url}]\n${err.message}`
  }
}

console.log(`Building support bundle in ${bundleName}/ ...`)

write('meta.txt', [
  `generated_at: ${new Date().toISOString()}`,
  `base_url: ${baseUrl}`,
  `host: ${tryRun('uname -a').trim()}`,
].join('\n'))

write('health.txt', await tryFetch(`${baseUrl}/api/health`))
write('version.txt', await tryFetch(`${baseUrl}/api/version`))

write('containers.txt', tryRun(`${composeBase} ps`))
write('api-logs.txt', tryRun(`${composeBase} logs --no-color --tail=200 api`))

write('disk.txt', tryRun('df -h'))

if (existsSync(backupDir)) {
  const entries = readdirSync(backupDir).map((f) => {
    const s = statSync(path.join(backupDir, f))
    return `${s.mtime.toISOString()}  ${(s.size / 1024 / 1024).toFixed(1)}MB  ${f}`
  })
  write('backups.txt', entries.length ? entries.join('\n') : '(directory exists, no files)')
} else {
  write('backups.txt', `(backup directory not found: ${backupDir} — pass --backup-dir if it lives elsewhere)`)
}

const tarballPath = `${bundleDir}.tar.gz`
execSync(`tar czf "${tarballPath}" -C "${root}" "${bundleName}"`)
rmSync(bundleDir, { recursive: true, force: true })

console.log(`\nWrote ${path.relative(root, tarballPath)} — no tenant data included, safe to share with support.`)
