# Deployment runbook

AssetCore is licensed and deployed on the client's own infrastructure — this
is the runbook for standing up a fresh instance. It assumes AssetCore staff
or the client's ICT team, with root/sudo on the target host, are following it.

## Prerequisites

- **A Linux host with Docker Engine + the Docker Compose plugin.** A VM is
  fine. Confirm this early with the client's ICT team — some default to
  Windows Server, which this stack does not target.
- DNS name(s) for the instance (e.g. `assetcore.client.example`).
- TLS certificates for that name, or a reverse proxy / load balancer in front
  that terminates TLS (see `deploy/nginx/nginx.conf` for both options).
- An SMTP relay for password-reset and invite emails (host, port, credentials).
  Without one, the API prints those emails to its container logs instead —
  acceptable for a first commissioning, not for steady-state production.
- A **staging instance recommended**: a second Compose project on the same
  host (different `HTTP_PORT`, different Postgres volume) where updates are
  applied and smoke-tested before production. This is the safe update path
  the maintenance contract depends on — see `docs/UPGRADE.md`.

## 1. Unpack the release

Extract the release tarball (`assetcore-vX.Y.Z.tar.gz`, built by `npm run
package` — see its own section below) to a directory on the host, e.g.
`/opt/assetcore`. It contains:

```
apps/app/dist/, apps/admin/dist/  # pre-built SPA bundles, already branded
apps/api/dist/, apps/api/Dockerfile
node_modules/                     # vendored so nothing needs the npm registry
db/migrations/
deploy/                           # compose file, nginx config + Dockerfile, .env.deploy.example
docs/
scripts/{migrate,provision,support-bundle}.mjs
package.json / package-lock.json
```

Both Dockerfiles (`apps/api/Dockerfile`, `deploy/nginx/Dockerfile`) only
*copy* these pre-built artifacts — `docker compose ... up -d --build` does
not run `npm install` or `npm run build` inside the container, so this whole
runbook works on a host with no internet access. Per-client branding
(`VITE_INSTANCE_*`) is already baked into the SPA bundles from when the
tarball was built; rebranding means rebuilding and re-shipping the tarball,
not editing anything on the client's box.

`cd` into that directory for every command below.

## 2. Configure the instance

```
cp deploy/.env.deploy.example deploy/.env.deploy
```

Fill in `deploy/.env.deploy`: generate `POSTGRES_PASSWORD` and `JWT_SECRET`
with `openssl rand -hex 32`, set `APP_ORIGIN` to the public URL, set
`VITE_INSTANCE_*` for branding (baked in at build time), set SMTP if
available. Leave `DATABASE_URL`/`DATABASE_URL_OWNER` as-is for now — the app
role's password is rotated in step 5.

```
cp deploy/instance.config.json.example deploy/instance.config.json
```

Fill in the client org name, owner account, and our staff/platform-admin
accounts — see the comments in the file.

## 3. Bring up Postgres

```
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.deploy up -d postgres
```

Wait for it to report healthy: `docker compose -f deploy/docker-compose.yml ps`.

## 4. Run migrations

```
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.deploy \
  run --rm api node /repo/scripts/migrate.mjs
```

This builds the `api` image (first run only) and applies `db/migrations/*.sql`
against `DATABASE_URL_OWNER`, recording each in `schema_migrations`.

## 5. Rotate the app role password

`0001_baseline.sql` creates `assetcore_app` with a fixed placeholder password
(`assetcore_app`) — fine for local dev, not for a client's server. Rotate it
now, before starting the API:

```
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.deploy exec postgres \
  psql -U postgres -d assetcore -c "ALTER ROLE assetcore_app WITH PASSWORD 'PASTE_A_GENERATED_PASSWORD_HERE';"
```

Update `DATABASE_URL` in `deploy/.env.deploy` to use that same password.

## 6. Provision the client org

```
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.deploy \
  run --rm -v "$(pwd)/deploy/instance.config.json:/repo/deploy/instance.config.json:ro" \
  api node /repo/scripts/provision.mjs
```

Creates the org, the owner account (prints a one-time temp password — record
it and hand it to the client's designated owner), our staff/platform-admin
accounts, and the `licence_info` row. Idempotent — re-running with an
unchanged config touches nothing, so it's safe to re-run after editing
`instance.config.json`.

## 7. Start the API and web tier

```
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.deploy up -d --build
```

This (re)builds the `api` and `nginx` images (the latter bundles both SPAs,
branded per `VITE_INSTANCE_*`) and starts all three services.

## 8. Smoke test

- `curl -s http://<host>/api/health` → `{"ok":true,...}`
- Browse to `https://<host>/` → login page, sign in as the owner with the
  temp password from step 6 → forced password change → onboarding wizard
  (Welcome → Sites → Categories) → dashboard.
- Browse to `https://<host>/admin/` → our internal console, reachable and
  showing this client's instance (VPN/allowlist this path at the network
  layer — see `docs/SECURITY.md`).
- Confirm the licence card on Settings matches `instance.config.json`.

That's a working instance. For day-2 operations (backups, monitoring, user
admin, licence renewal), see `docs/OPERATIONS.md`. For applying a later
release, see `docs/UPGRADE.md`.
