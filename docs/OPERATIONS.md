# Operations runbook

Day-2 operations for a running instance.

## Backups

**Nightly, automated** (cron on the host, outside the containers):

```
# /etc/cron.d/assetcore-backup
0 2 * * * root cd /opt/assetcore && docker compose -f deploy/docker-compose.yml --env-file deploy/.env.deploy \
  exec -T postgres pg_dump -U postgres -Fc assetcore > /var/backups/assetcore/db-$(date +\%Y\%m\%d).dump
```

Also back up the files volume (asset photos, WO attachments, compliance
documents, generated reports) — it's a plain Docker volume, so:

```
docker run --rm -v assetcore_files:/data -v /var/backups/assetcore:/backup \
  alpine tar czf /backup/files-$(date +%Y%m%d).tar.gz -C /data .
```

Retain at least 14 daily backups off the host itself (client's existing
backup infrastructure, or a second location) — a backup that lives only on
the box it protects isn't a backup.

## Restore drill

Do this at least once, before you need it for real:

```
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.deploy exec -T postgres \
  pg_restore -U postgres -d assetcore --clean --if-exists < db-YYYYMMDD.dump
```

Restore the files volume by untarring into a fresh `assetcore_files` volume.
Verify with a login + a spot-check of an asset photo or report download.

## User administration

Day-to-day user management (invite, role change, disable) is self-service via
**Admin → Users** in the app, for anyone with the owner role — no shell
access needed. Use the CLI only for the one-off account bootstrap in
`docs/DEPLOYMENT.md` step 6.

## Licence renewal

Edit `licence_info` via the backoffice (`/admin/` → Licence & Invoices),
which audits the change in Platform Audit. Licence enforcement is soft
(expiry banners only) — nothing locks the client out, so renewal is not
time-critical to safety, only to the commercial relationship.

## Monitoring basics

- `GET /api/health` — DB connectivity, safe to poll from an external monitor.
- `GET /api/version` — app version + latest applied migration, useful to
  confirm what's actually running on a given box during support.
- API logs are structured JSON (pino) in the `assetcore_logs` volume,
  rotated automatically (`pino-roll`) — tail with
  `docker compose logs -f api` or read the volume directly.
- `docker compose ps` for container health/restart-loop detection.
- For a one-shot diagnostic bundle (useful when the client reports an issue
  and we're supporting remotely): `node scripts/support-bundle.mjs` — see its
  header comment for what it collects (no tenant data).

## Scheduled jobs

`node-cron`, running inside the `api` container (not a client cron job):
`generate_pm_tasks` (06:00 `TZ`), `mark_overdue_pm_tasks` (00:05), and
`check_licence_expiry` (07:00). If these appear to have stopped, check
`docker compose logs api` for the "cron jobs scheduled" line at container
start and confirm the container hasn't been restarting.
