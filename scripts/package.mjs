#!/usr/bin/env node
// ============================================================================
// RELEASE PACKAGER — builds both SPAs + the API, then bundles everything a
// client's Docker host needs into assetcore-vX.Y.Z.tar.gz: pre-built dist
// output, node_modules (vendored so nothing needs npm registry access on
// the client's box — see docs/DEPLOYMENT.md), db/migrations, deploy/, docs/,
// and the runtime scripts (migrate/provision/support-bundle).
//
// Set VITE_INSTANCE_NAME / VITE_INSTANCE_CLIENT / VITE_SUPPORT_EMAIL before
// running this to brand the SPA bundles for a specific client — they're
// baked in at build time here, not read at container runtime.
//
// Usage: npm run package
// ============================================================================
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'))
const releaseName = `assetcore-v${pkg.version}`
const stagingRoot = path.join(root, 'dist-release')
const stagingDir = path.join(stagingRoot, releaseName)
const tarballPath = path.join(root, `${releaseName}.tar.gz`)

function run(cmd) {
  console.log(`\n$ ${cmd}`)
  execSync(cmd, { cwd: root, stdio: 'inherit' })
}

function copy(rel, { optional = false } = {}) {
  const src = path.join(root, rel)
  if (!existsSync(src)) {
    if (optional) return
    throw new Error(`missing required path for packaging: ${rel}`)
  }
  const dest = path.join(stagingDir, rel)
  mkdirSync(path.dirname(dest), { recursive: true })
  // verbatimSymlinks keeps workspace links (node_modules/@assetcore/* ->
  // ../../packages/*) relative, so they still resolve after the tarball is
  // extracted on the client's box — packages/* is copied alongside below.
  cpSync(src, dest, { recursive: true, verbatimSymlinks: true })
}

console.log(`Packaging ${releaseName}...`)

run('npm run build:app')
run('npm run build:admin')
run('npm run build:api')

rmSync(stagingRoot, { recursive: true, force: true })
mkdirSync(stagingDir, { recursive: true })

// Pre-built artifacts — the whole point is the client's Docker host never
// runs `npm install` or a build step (see apps/api/Dockerfile, deploy/nginx/Dockerfile).
copy('node_modules')
// Workspace packages the API imports at runtime (node_modules/@assetcore/*
// are symlinks into packages/, so the targets must ship too).
copy('packages/rbac')
copy('apps/app/dist')
copy('apps/admin/dist')
copy('apps/api/dist')
copy('apps/api/package.json')
copy('apps/api/Dockerfile')

copy('db/migrations')

copy('deploy/docker-compose.yml')
copy('deploy/.env.deploy.example')
copy('deploy/instance.config.json.example')
copy('deploy/nginx/Dockerfile')
copy('deploy/nginx/nginx.conf')

copy('docs')

copy('scripts/migrate.mjs')
copy('scripts/provision.mjs')
copy('scripts/support-bundle.mjs')

copy('package.json')
copy('package-lock.json')
copy('README.md')
copy('CHANGELOG.md')

run(`tar czf "${tarballPath}" -C "${stagingRoot}" "${releaseName}"`)
rmSync(stagingRoot, { recursive: true, force: true })

console.log(`\nWrote ${path.relative(root, tarballPath)}`)
