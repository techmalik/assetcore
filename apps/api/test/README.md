# API integration tests

Vitest + Supertest against a real, disposable Postgres database — not mocks.
RLS policies, capability gates, and per-request scope resolution only mean
anything when exercised against the actual database engine that enforces them.

## Prerequisites

A Postgres 16 instance reachable from this machine, plus an empty
`assetcore_test` database on it (separate from the dev `assetcore` database —
tests write and mutate rows freely and never clean up after themselves,
because the fixtures are idempotent and the database is disposable).

If you don't already have Postgres running locally:

```
docker run --name assetcore-test-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
```

Then create the test database once:

```
PGPASSWORD=postgres psql -h localhost -U postgres -c "CREATE DATABASE assetcore_test;"
```

## Running

```
npm test -w @assetcore/api
```

This runs `scripts/migrate.mjs` against the test database automatically
(idempotent — safe to run every time) before the suite starts, so there's no
separate migrate step. Point at a different Postgres via env vars if needed:

```
TEST_DATABASE_URL=postgres://assetcore_app:assetcore_app@HOST:5432/assetcore_test \
TEST_DATABASE_URL_OWNER=postgres://postgres:postgres@HOST:5432/assetcore_test \
npm test -w @assetcore/api
```

## Layout

- `fixtures.ts` — fixed-UUID fixture rows (2 orgs, 3 sites, 3 assets, one
  membership per role) seeded idempotently via the owner pool. Import the
  exported IDs/emails rather than querying for them.
- `helpers.ts` — `apiAs(email)` logs in as a fixture user through the real
  `/auth/login` route and returns a small authenticated request builder.
- `*.test.ts` — the suites themselves. Tests share the same fixture rows
  across files (`fileParallelism: false` in `vitest.config.ts`), so avoid
  mutating a shared fixture's identity (role, scope) in a test other suites
  rely on — add a dedicated fixture user instead (see `USERS.revocable`).
