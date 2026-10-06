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

On a native install (Postgres.app, Homebrew) there is usually no `postgres`
role — the superuser is named after your macOS account — so the owner URL has
to be overridden or the run fails before the first test:

```
createdb assetcore_test
TEST_DATABASE_URL=postgres://assetcore_app:assetcore_app@localhost:5432/assetcore_test \
TEST_DATABASE_URL_OWNER=postgres://$USER@localhost:5432/assetcore_test \
npm test
```

## Layout

- `fixtures.ts` — fixed-UUID fixture rows (2 orgs, 3 sites, 3 assets, one
  membership per role) seeded idempotently via the owner pool. Import the
  exported IDs/emails rather than querying for them.
- `setup.ts` — runs in every file (`setupFiles`) and seeds the fixtures, so a
  suite does not call `seedFixtures()` itself.
- `helpers.ts` — `apiAs(email)` logs in as a fixture user through the real
  `/auth/login` route and returns a small authenticated request builder
  (`type Api`); `withClient(fn)` runs `fn` with an owner-pool client and
  closes it; `uniqueSuffix()` keeps names and codes unique.
- `factories.ts` — `makeSite` and `makeAsset` create fresh records through
  the API when a test must not touch a shared fixture.
- `*.test.ts` — the suites themselves, named for the feature they cover. A
  regression found in a UAT round keeps the round and finding in its
  `describe` name ("UAT round 2, F10: ..."), not in the file name. Tests share the same fixture rows
  across files (`fileParallelism: false` in `vitest.config.ts`), so avoid
  mutating a shared fixture's identity (role, scope) in a test other suites
  rely on — add a dedicated fixture user instead (see `USERS.revocable`).
