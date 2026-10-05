# Code cleanup audit: inventory

## Intent

```
Question:    What dead code can be removed from the portal, and what should be refactored to make the code better?
Decision:    Which removals and refactors to approve for implementation (audit first, nothing changed yet).
Judged against: the app's purpose and its own conventions (CLAUDE-style rules in commits, memory decisions); no external spec.
Deliverable: report + implementation plan + session prompts.
Scope:       in: apps/app (the tenant portal), the apps/api routes and modules it calls, packages/rbac, packages/ui.
             out: apps/admin (backoffice) except where it is the only caller of an API route; behaviour changes, security and UX findings (logged to OUT-OF-SCOPE.md).
Constraints: audit only, no code changes; refactors must be behaviour-preserving; work lands on main by fast-forward (memory: uat-work-lands-on-main); one codebase, per-client config, never fork.
Done when:   every dead-code candidate is classed confirmed / keep (with reason), and every refactor is a plan task with a verify step.
```

Assumption: "the portal" = the tenant web app at `/` and the API behind it. If you meant the backoffice too, say so and it gets the same pass.

## Baseline

- Branch `main`, commit `913e934` (2026-10-05). Uncommitted: `deploy/docker-compose.dev.yml` port 5432 -> 55432 (local only, not audited).
- Size: apps/app ~18.5k lines (JS/JSX), apps/api ~14.8k lines (TS incl. tests), apps/admin ~1.9k, packages/rbac 205, packages/ui 645 (CSS).

## Stack

- apps/app: React 18 + Vite 5 + react-router 6, plain JS/JSX, no linter, no tests, no TypeScript.
- apps/api: Node 20, Express 5, TypeScript strict, pg, zod, vitest + supertest against real Postgres.
- packages/rbac: role -> capability map shared by app and API. packages/ui: one shared CSS file.

## Tools run

| Tool | Result |
|---|---|
| `tsc --noEmit --noUnusedLocals` (apps/api) | clean, 0 unused locals |
| `knip@5.88.1` (config in scratchpad, entries: app/admin main.jsx, api index.ts + tests, scripts) | 3 unused files, 2 unused deps, 36 unused exports, 6 unused types. Raw: `knip-raw.txt`. Unused *exports* include symbols used inside their own file; each is verified in 05a/05b. |
| ESLint | not configured in the repo; not run |

## Phase files

- `05a-dead-code-frontend.md`, `05b-dead-code-api.md`, `05c-refactor-frontend.md`, `05d-refactor-api.md`

## Safety net at baseline (run 2026-10-05)

| Check | Result |
|---|---|
| `npm run build:app` | builds; one 962 kB JS chunk (Vite warns > 500 kB; no code splitting) |
| `tsc --noEmit` (apps/api) | clean |
| API tests (`vitest run`, native Postgres, owner URL overridden per test/README.md) | **14 files, 236 tests, all pass**, 11 s |
| Frontend tests | none exist |
| Lint | none configured in any workspace |
| CI | `.github/workflows/deploy.yml` only: every push to `main` SSHes to the VPS and runs `deploy/deploy.sh`. No build, typecheck or test step runs before it. |

Consequence for this audit: the API can be refactored behind 236 integration tests; the frontend (18.5k lines) has no automated net at all, so frontend refactors need a lint + smoke-test step first.
