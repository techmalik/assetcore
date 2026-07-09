# AssetCore

Licensed, client-hosted asset management for critical infrastructure operators. Not a SaaS product — each deployment is commissioned, configured, and maintained for a single client under an annual licence + maintenance agreement.

## Stack

PostgreSQL 16 + `apps/api` (Node 20, Express, TypeScript) + nginx, serving `apps/app` (tenant product) and `apps/admin` (AssetCore's internal client-instance console).

## Dev quickstart

```
docker compose -f deploy/docker-compose.dev.yml up -d   # postgres only
node scripts/migrate.mjs
node scripts/seed-dev.mjs      # demo org, users, sample data — dev only
npm run dev:api                # apps/api on :8787
npm run dev                    # apps/app on :5175 (proxies /api)
npm run dev:admin              # apps/admin on :5176
```

## Deploying to a client

See `docs/DEPLOYMENT.md` for the full runbook. In short: `npm run package`
builds both SPAs + the API and bundles everything a client's Docker host
needs (pre-built dist output, vendored `node_modules`, migrations, deploy
configs, docs) into `assetcore-vX.Y.Z.tar.gz` — no npm registry access is
required on the client's box. `docs/UPGRADE.md`, `docs/OPERATIONS.md`, and
`docs/SECURITY.md` cover applying later releases, day-2 operations
(backups, monitoring, licence renewal), and the auth/RLS/network security
model, respectively. See `CHANGELOG.md` for what shipped in each release.

## Backlog

Explicitly parked, not part of the current licensed build:

- Approvals UI (`public.approvals` table exists, unused)
- `notification_preferences` — no per-channel opt-in/out UI
- Email/SMS notification channels (in-app + polling only)
- `memberships.site_scope` enforcement (column exists, not checked)
- Telemetry ingest (`devices`/`telemetry_readings` schema exists, no ingest path)
- SSO (Azure AD) — `signInWithSSO` boundary reserved in `apps/app/src/lib/auth.js`, not implemented
- MFA
- PDF report generation (CSV/XLSX only)
- SSE/websocket realtime (30s polling instead)
- Live SAP / Termii / SCADA connector wiring — commissioned per client engagement, not part of this overhaul
