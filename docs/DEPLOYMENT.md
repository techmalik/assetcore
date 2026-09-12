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
  acceptable for a first commissioning, not for steady-state production. See
  *Email delivery (SMTP)* below for the options, including hosted services.
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

## Email delivery (SMTP)

AssetCore sends exactly three transactional emails — the invite, the
admin-triggered password reset, and the self-service "forgot password" — all
through one nodemailer SMTP transport (`apps/api/src/auth/mailer.ts`). There is
no provider SDK, so anything that speaks SMTP works, configured entirely in
`deploy/.env.deploy`:

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587           # 587 = STARTTLS, 465 = implicit TLS, 25 = unauthenticated relay
SMTP_SECURE=            # leave blank: follows the port (465 → on)
SMTP_USER=
SMTP_PASS=
SMTP_FROM=AssetCore <no-reply@client.example>
```

Three options, in the order we recommend them:

1. **The client's own relay** (Exchange, Postfix, their ISP's smarthost).
   The default for a licensed on-prem instance: mail leaves from a domain the
   client already owns, no third party sees their user list, and nothing new
   has to be procured. Ask their ICT team for host, port, and whether the
   instance's IP may relay unauthenticated (common internally, `SMTP_USER`
   and `SMTP_PASS` then stay blank).
2. **Microsoft 365 / Google Workspace**, if they have no relay but do have
   mailboxes. `smtp.office365.com:587` or `smtp.gmail.com:587` with a
   dedicated service account. Both need an app password or SMTP AUTH enabled
   on that account, and both throttle hard — fine for this volume.
3. **A hosted sending service** — Resend (`smtp.resend.com:465`, user
   `resend`, pass = API key) or SendGrid (`smtp.sendgrid.net:587`, user
   `apikey`, pass = API key). Both expose plain SMTP, so they need no code
   change, only these five variables. Use this when the client has no usable
   relay or their outbound mail keeps landing in spam. It does mean a third
   party handles their mail, and the instance needs outbound internet — check
   both against the client's policy before proposing it.

Whichever is chosen, publish SPF (and DKIM where the provider supports it) for
the `SMTP_FROM` domain, or password-reset mail will be filtered.

**Verify after configuring**: trigger a real send rather than trusting the
config. Admin → Users & Roles → invite a throwaway address. The confirmation
reads "Invite sent — we emailed the set-password link" when delivery
succeeded, and "Invite created — email delivery isn't available on this
instance" when it did not. The link is shown either way, so an admin can
always hand it over; `docker compose logs api` carries the SMTP error behind a
failure.

With no `SMTP_HOST` the API prints each message to its container logs and the
UI falls back to showing the link. That is a workable commissioning state and
an acceptable one for a small instance whose admin onboards everyone by hand —
it is not acceptable where users reset their own passwords, since the
self-service flow has nowhere to show a link.

## Appendix: what the automated VPS deploy does (and its migration lag)

`.github/workflows/deploy.yml` SSHes into the production VPS on every push to
`main` and runs `/opt/assetcore/deploy/deploy.sh`. That script lives on the
server, not in this repo. Two behaviours of it are worth knowing before you
rely on a push to land a schema or data change:

- **Migrations run one deploy behind.** The script applies migrations with
  `docker compose run --rm api node /repo/scripts/migrate.mjs` *before* it
  rebuilds the images. `db/` is baked into the `api` image at build time, so
  that run sees the migration set from the **previously built** image, not the
  commit being deployed. A migration added in commit N is therefore applied by
  the deploy of commit N+1. Verified in the 2026-08-04 run: it applied
  `0015`–`0018` (shipped 2026-08-02) while `0019` sat in the checkout.
- **A re-run on an unchanged HEAD is a no-op.** The script exits early with
  "No new commits and TLS config already in place. Nothing to do." — so
  `workflow_dispatch` cannot be used to force a pending migration through.
  Only a new commit on `main` will do it.

If a migration must land with its own deploy, run it directly on the server
after the deploy finishes (the freshly built image contains it by then):

```
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.deploy \
  run --rm api node /repo/scripts/migrate.mjs
```

Fixing this properly means reordering `deploy.sh` on the VPS to rebuild the
`api` image before running migrations.
