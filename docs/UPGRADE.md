# Upgrade runbook

Applying a new release to an existing instance. Read the release's entry in
`CHANGELOG.md` first — it calls out anything unusual (a breaking migration,
a config change, a manual step).

**Always upgrade the staging instance first**, smoke-test it, then repeat
against production. This is the reason `docs/DEPLOYMENT.md` recommends
running a staging Compose project on the same host.

## 1. Back up

```
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.deploy exec postgres \
  pg_dump -U postgres -Fc assetcore > backup-$(date +%Y%m%d-%H%M).dump
```

Also snapshot the files volume (`assetcore_files`) — see
`docs/OPERATIONS.md` for the full backup procedure. Don't proceed without a
verified backup.

## 2. Unpack the new release

Extract the new `assetcore-vX.Y.Z.tar.gz` alongside (not over) the current
deployment directory, e.g. `/opt/assetcore-vX.Y.Z`. Copy across the
existing, filled-in `deploy/.env.deploy` and `deploy/instance.config.json` —
never regenerate these from the `.example` files.

## 3. Migrate

```
cd /opt/assetcore-vX.Y.Z
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.deploy \
  run --rm api node /repo/scripts/migrate.mjs
```

Migrations are additive and idempotent (`schema_migrations` tracks what's
applied) — this is safe to run against the existing database.

## 4. Rebuild and switch over

```
docker compose -f deploy/docker-compose.yml --env-file deploy/.env.deploy up -d --build
```

Point the reverse proxy / DNS at the new Compose project's port (or just
reuse `/opt/assetcore` as a stable symlink to the current release directory
and swap the symlink target here). Stop the old release's containers once
the new one is confirmed healthy.

## 5. Smoke test

Same checklist as `docs/DEPLOYMENT.md` step 8: health check, login →
dashboard, `/admin/` reachable, licence card correct.

## Rollback

If the smoke test fails: restore the pre-upgrade database dump into a fresh
`postgres` volume, point Compose back at the previous release directory, and
bring that back up. This is why step 1 isn't optional — there's no "undo a
migration" path, only "restore the backup taken before you migrated."
