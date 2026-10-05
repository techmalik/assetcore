# Implementation plan: portal dead-code removal and refactoring

Source audit: `audit/code-cleanup-2026-10-05/AUDIT-REPORT.md` (phase files 05a-05d hold full evidence).
Baseline: `main @ 913e934`. Every `file:line` below is at that commit; find the spot again by the symbol or grep given, because earlier tasks move lines.

## 0. Binding rules for every session

1. **Behaviour-preserving unless the task says otherwise.** A task that changes behaviour names the change and the decision (Q-number) that allows it. Put that change in its own commit, with the reason in the message.
2. **Work on a topic branch, then fast-forward `main`.** Commit on `cleanup/<wave>`, then run `git checkout main && git merge --ff-only cleanup/<wave> && git push origin main`. Check it really is a fast-forward first; never create a merge commit. Push the topic branch too.
3. **One commit per task.** Title the commit by the effect, in the repo's voice ("Check a permission once per request, not once per router"), with a body that explains why. No attribution lines.
4. **Run before every commit:** `npm run lint` (from TASK-0.2 on), `npm run build`, `npm run build:api`, and the API tests (command in "Verification setup"). If any were red before you started, say so in the commit and do not make them worse.
5. **Migrations:** add new files only, at the next free number (`ls db/migrations | tail -1`, then +1; written `<NEXT>` below). Never edit an existing migration. Apply locally with `node scripts/migrate.mjs`.
6. **Never two sessions on the same file at once.** The wave order below says what may run in parallel.
7. **Copy and naming:** plain sentences, no em dashes, the British spelling the repo already uses ("organisation", "licence").
8. **Do not touch** `apps/admin/src` except where a task names it. Do not change `deploy/docker-compose.dev.yml`: it has a local uncommitted port change.
9. **Decisions in section 3 are applied as written.** If an answer changes, the tasks marked with that Q change with it.

## 1. Repo orientation

- `apps/app`: tenant portal. React 18, Vite 5, plain JS/JSX. Pages are in `src/pages`, shared UI in `src/components`, API helpers in `src/lib/db/*.js` over `src/lib/apiClient.js`. Permission checks go through `src/lib/rbac.js` (a re-export of `@assetcore/rbac`).
- `apps/api`: Express 5 + TypeScript strict + `pg`. Routers are in `src/routes/*.ts`, mounted in `src/routes/index.ts`. All tenant DB work goes through `withOrgContext` (`src/db.ts`), which sets RLS settings. Audit writes go through `writeAuditLog` (`src/audit.ts`). Tests: `apps/api/test/*.test.ts` (integration, real Postgres) and `apps/api/src/*.test.ts` (unit).
- `packages/rbac`: role to capability map shared by app and API (`index.js` + `index.d.ts`). `packages/ui/index.css` is the only stylesheet the app uses (apps/admin uses Mantine).
- `db/migrations`: SQL, append-only. `scripts/seed-dev.mjs` seeds a demo org.

## 2. Verification setup

```bash
# Postgres 16 must be listening on localhost:5432.
createdb assetcore_test   # once
# Native install (Homebrew / Postgres.app): there is no "postgres" role, so override the owner URL
TEST_DATABASE_URL=postgres://assetcore_app:assetcore_app@localhost:5432/assetcore_test \
TEST_DATABASE_URL_OWNER=postgres://$USER@localhost:5432/assetcore_test \
npm test -w @assetcore/api
```

Baseline: 14 files, 236 tests, all pass (2026-10-05). The app is checked with `npm run build`, and from Wave 0 on with `npm run lint` and `npm test -w @assetcore/app`. To see the running app: `npm run dev:api` plus `npm run dev` (port 5175), signed in with the seeded `a.okeke@ngml.example` (`Password123!` per `scripts/seed-dev.mjs`).

## 3. Decisions (applied by default)

| Q | Decision | Applied answer | Tasks |
|---|---|---|---|
| Q1 | Spare Parts (page, 11 routes, helpers) | Keep parked; delete only `listMovements` | 1.4 |
| Q2 | Documents registry | Delete panel, helper, routes, tests now; drop the table later after a row count | 1.4, 1.6 |
| Q3 | Reports API | Delete routes, `buildReportData`, tests; keep the `reports` file resolver and table | 1.4 |
| Q4 | Endpoints with no screen | Keep the API routes; delete the unused frontend helpers; backlog PM schedule edit, template editor, part-line edit | 1.1 |
| Q5 | Platform endpoints | Keep org create/suspend/restore and document them; delete `POST /admin/users/:id/invite` | 1.4 |
| Q6 | Behaviour changes riding on refactors | Accept (a) WO status only via `/transition`, (b) approval notifications respect preferences, (c) uploads sniffed, (d) 4xx not 500, (e) toasts and in-app confirms, (f) SQL today in instance TZ, (g) 404 on re-archiving an audit | 1.2, 2.5, 2.6, 2.7, 2.9, 4.6, 5.1 |
| Q7 | Visual unification | Low priority = grey (`--n600`); labels use `.label` (weight 500) | 3.2, 4.7 |
| Q8 | CI gate on deploy | Yes: deploy waits for the check workflow | 0.1 |
| Q9 | Tracked UAT and audit records | Keep in repo | none |

## 4. Owner actions

1. **Give the row counts** of `public.sms_log` and `public.documents` on NGML production. TASK-1.6 is BLOCKED on this.
2. **Confirm Q8** (CI gate), if you want a different answer. TASK-0.1 changes `.github/workflows/deploy.yml`.
3. **After TASK-0.1 lands, open one PR or push and confirm the "check" workflow ran green in GitHub Actions.** Only you can see the Actions tab result for this repo.

## 5. Status

| Task | Title | Wave | Effort | Status |
|---|---|---|---|---|
| 0.1 | Make the deploy wait for lint, typecheck, build and tests | 0 | M | Done `d9e0f04` (awaiting first green run in Actions) |
| 0.2 | Add ESLint to the app | 0 | S | Done `ed55a7b` (cap 28 warnings, not 20: the 16 alert() calls count) |
| 0.3 | Typecheck the API's test files | 0 | S | Done `baae166` (tests already clean) |
| 0.4 | Commit the dead-code check so new dead code shows up | 0 | S | Done `89332e9` (in `npm run check`; Dashboard's `initialsOf` copy merged) |
| 0.5 | Add a unit-test runner to the app and cover the pure helpers | 0 | S | Done `4701f73` (vitest 2: vitest 5 needs Vite 6; 29 tests) |
| 1.1 | Remove the app's dead code | 1 | M | Done `1272f40` (lint warnings 28 -> 18) |
| 1.2 | Remove the API's dead code and the shadowed audit DELETE | 1 | M | Done `ff96080` |
| 1.3 | Retire the old linear-decay health SQL | 1 | M | Done `bf07cb6` (migration 0029) |
| 1.4 | Remove the documents registry, Reports API and platform invite | 1 | M | Done `92a63b2` (`report:create` now gates nothing; TASK-2.2 removes it) |
| 1.5 | One version source, and call the liveness router "system" | 1 | S | Done `a71f3a7` |
| 1.6 | Drop the unused `sms_log` and `documents` tables | 1 | S | BLOCKED (owner action 1) |
| 2.1 | Check auth and membership once per request | 2 | M | Open |
| 2.2 | Put a capability check on every tenant route, and test it stays that way | 2 | M | Open |
| 2.3 | One way to read the caller's live role | 2 | S | Open |
| 2.4 | Owner-pool transaction helpers; rewrite member management on them | 2 | M | Open |
| 2.5 | One upload pipeline for all upload routes | 2 | M | Open |
| 2.6 | Answer client mistakes with 4xx, not 500 | 2 | S | Open |
| 2.7 | Make SQL "today" the instance's date in every route | 2 | S | Open |
| 2.8 | Safe reference numbers for defects, risks and audits | 2 | M | Open |
| 2.9 | Send approval notifications through the notify helpers | 2 | S | Open |
| 2.10 | Move membership resolution out of the auth router | 2 | S | Open |
| 2.11 | Add request helpers for parsing, result mapping and list queries | 2 | M | Open |
| 3.1 | Shared value lists in `packages/domain`, used by the API | 3 | M | Open |
| 3.2 | App labels and tones keyed by the shared lists; one status badge | 3 | M | Open |
| 4.1 | One `useCan()` hook so per-user grants count everywhere | 4 | S | Open |
| 4.2 | Show every failed save; one error-text path | 4 | S | Open |
| 4.3 | One date module and money through `useMoney` | 4 | S | Open |
| 4.4 | Stable context values and an error path for sign-in loading | 4 | S | Open |
| 4.5 | `useResource` hook for loading, errors and stale responses | 4 | M | Open |
| 4.6 | One `<Modal>`, an in-app confirm, and toasts instead of alerts | 4 | M | Open |
| 4.7 | Shared `Stat`, `EmptyState`, `TableState`, `Field` | 4 | S | Open |
| 4.8 | Profile, password and file helpers in `lib`, one query-string builder | 4 | S | Open |
| 5.0 | Route smoke test for each role | 5 | M | Open |
| 5.1 | One way to close a work order | 5 | L | Open |
| 5.2 | Split `approvals.ts` into rules, reads, matrix and direct | 5 | M | Open |
| 5.3 | Split `workOrders.ts` into core, tasks and parts | 5 | M | Open |
| 5.4 | Split `assets.ts`; move import and transfer to services | 5 | M | Open |
| 5.5 | Split `compliance.ts`; share defect creation | 5 | M | Open |
| 5.6 | One file per export dataset | 5 | M | Open |
| 5.7 | One fetch core in `apiClient.js` | 5 | M | Open |
| 5.8 | Split `Admin.jsx` by tab | 5 | M | Open |
| 5.9 | Split `WorkOrders.jsx` | 5 | M | Open |
| 5.10 | Split `Assets.jsx` | 5 | L | Open |
| 5.11 | Extract the Maintenance week strip and modals | 5 | S | Open |
| 6.1 | Shared test helpers; name test files by feature | 6 | S | Open |
| 6.2 | Test that TS and SQL depreciation agree | 6 | S | Open |
| 6.3 | Page shell, theme context and one route table | 6 | M | Open |
| 6.4 | `auditFromReq` so every audit row carries actor, org and IP | 6 | M | Open |

### Wave order and parallelism

- **Wave 0** must land first, in order 0.2, 0.3, 0.5, 0.4, then 0.1 (0.1 runs what the others add).
- **Wave 1:** 1.1 and 1.2 can run in parallel (app vs API). Run 1.3, 1.4 and 1.5 one after another after 1.2 (1.2 and 1.4 both edit `compliance.ts` and `routes/index.ts`).
- **Wave 2:** 2.1 first and alone (it touches the top of every route file). Then 2.2. After that, these are parallel-safe in pairs on disjoint files: 2.3 then 2.9 (approvals); 2.4 then 2.10 (orgMembers, auth); 2.5; 2.6 + 2.7 (app.ts, db.ts); 2.8; 2.11.
- **Wave 3:** 3.1 then 3.2. Can overlap with Wave 4 tasks that do not touch `lib/db/*.js` lists.
- **Wave 4:** 4.1, 4.2, 4.3, 4.4 in parallel (different files; check the Files lines). Then 4.5, 4.6, 4.7, 4.8 in parallel, each piloting on the pages its task names.
- **Wave 5:** 5.0 first. API: 5.1 then 5.3 (both `workOrders.ts`); 5.2, 5.4, 5.5, 5.6 each in its own session, any order. App: 5.7, then 5.8 to 5.11, one file per session.
- **Wave 6:** any time after Wave 2 (6.1, 6.2, 6.4) or after Wave 4 (6.3).

---

## Wave 0: Safety net

### TASK-0.1: Make the deploy wait for lint, typecheck, build and tests
- **Severity**: MEDIUM
- **Category**: ops
- **Effort**: M
- **Depends on**: TASK-0.2, TASK-0.3, TASK-0.5
- **Finding**: RF-API-31, RF-FE-30
- **Files**: `.github/workflows/check.yml` (new), `.github/workflows/deploy.yml`, `package.json` (root)

**Problem**: `.github/workflows/deploy.yml` is the only workflow. On every push to `main` it SSHes to the VPS and runs `/opt/assetcore/deploy/deploy.sh`. Nothing builds, typechecks, lints or tests first. Production gets whatever was pushed, even when the 236 API tests would fail.

**Fix**:
1. Add root scripts in `package.json`: `"lint": "npm run lint -w @assetcore/app"`, `"typecheck": "npm run typecheck -w @assetcore/api"` (0.3 adds the workspace script), `"check": "npm run lint && npm run typecheck && npm run build && npm run build:api && npm test -w @assetcore/app && npm test -w @assetcore/api"`.
2. Create `.github/workflows/check.yml`, triggered on `push` (all branches) and `pull_request`. Use one job `check` on `ubuntu-latest` with a `services.postgres` container (`postgres:16`, env `POSTGRES_PASSWORD: postgres`, port 5432, health option `pg_isready`). Steps: checkout, `actions/setup-node@v4` with Node 20 and npm cache, `npm ci`, `psql -h localhost -U postgres -c "create database assetcore_test"` (env `PGPASSWORD: postgres`), then `npm run check`. The API test defaults in `apps/api/vitest.config.ts` already match `postgres:postgres@localhost:5432/assetcore_test`.
3. In `deploy.yml`, change the trigger to `workflow_run: { workflows: ["check"], types: [completed], branches: [main] }`, keep `workflow_dispatch`, and add `if: ${{ github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success' }}` on the `deploy` job.

**Siblings**: none. `deploy/deploy.sh` lives only on the VPS and is not changed.

**Must not break**: manual `workflow_dispatch` deploys still work. The deploy step's secrets and script stay the same.

**Verify**: `npm run check` passes locally. Push the branch: the "check" workflow runs and goes green (owner action 3). Make a throwaway commit that breaks one API test, push it to a scratch branch, see "check" go red, then delete the branch. Confirm in the Actions tab that a `main` push now starts "deploy" only after "check" succeeds.

### TASK-0.2: Add ESLint to the app
- **Severity**: MEDIUM
- **Category**: cleanup
- **Effort**: S
- **Depends on**: none
- **Finding**: RF-FE-29
- **Files**: `apps/app/eslint.config.js` (new), `apps/app/package.json`

**Problem**: The app is plain JS with no linter. A missing import or undefined name builds fine and throws at runtime on that page. A dry run of the config below gave 0 errors, 9 unused-variable warnings, and 2 `exhaustive-deps` warnings (`AssetMapPage.jsx:36`, `Notifications.jsx:89`).

**Fix**:
1. Add devDependencies to `apps/app`: `eslint@^9`, `@eslint/js`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `globals`.
2. Create a flat config `apps/app/eslint.config.js` for `src/**/*.{js,jsx}`. Set `languageOptions.globals` to `globals.browser`, with JSX enabled. Rules: `no-undef: error`, `no-unused-vars: ['warn', { args: 'none', varsIgnorePattern: '^_' }]`, `react/jsx-no-undef: error`, `react/jsx-uses-vars: error`, `react/jsx-uses-react: off`, `react-hooks/rules-of-hooks: error`, `react-hooks/exhaustive-deps: warn`. Add `no-restricted-syntax: ['warn', { selector: "CallExpression[callee.name='alert']", message: 'Use toast' }]`.
3. Add `"lint": "eslint src --max-warnings=20"` to `apps/app/package.json`. The 20 leaves room for today's 9 warnings plus the alert warnings; TASK-1.1 and TASK-4.6 bring it down.

**Siblings**: apps/admin has no linter either; out of scope (rule 8).

**Must not break**: `npm run build` and the dev server unchanged.

**Verify**: `npm run lint -w @assetcore/app` exits 0. Add `foo()` to any page temporarily, see `no-undef` error, remove it.

### TASK-0.3: Typecheck the API's test files
- **Severity**: LOW
- **Category**: cleanup
- **Effort**: S
- **Depends on**: none
- **Finding**: RF-API-31
- **Files**: `apps/api/tsconfig.test.json` (new), `apps/api/package.json`, any test file with type errors

**Problem**: `apps/api/tsconfig.json` includes only `src` and excludes `src/**/*.test.ts`, and vitest strips types without checking them. So no test file has ever been typechecked (`test/assignmentNotifications.test.ts` has 18 `any`).

**Fix**:
1. Create `apps/api/tsconfig.test.json`: `extends ./tsconfig.json`, `compilerOptions: { noEmit: true, rootDir: "." , types: ["vitest/globals", "node"] }`, `include: ["src", "test"]`, `exclude: []`.
2. Add `"typecheck": "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.test.json"` to `apps/api/package.json`.
3. Run it and fix the errors it reports in test files only, by adding real types (`Awaited<ReturnType<typeof apiAs>>`, row types). Do not change `src` behaviour. If a test file needs more than 30 minutes of typing, put `// @ts-nocheck` on its first line with a comment naming TASK-6.1, and list it in the commit message.

**Siblings**: none.

**Must not break**: the 236 tests still pass.

**Verify**: `npm run typecheck -w @assetcore/api` exits 0, and the API test command passes.

### TASK-0.4: Commit the dead-code check so new dead code shows up
- **Severity**: LOW
- **Category**: cleanup
- **Effort**: S
- **Depends on**: TASK-1.1, TASK-1.2 (run after them so the baseline is clean)
- **Finding**: DC-API-18
- **Files**: `knip.json` (new, repo root), `package.json` (root)

**Problem**: knip found the unused files and exports for this audit, but only from a config kept outside the repo, and it reports `pino-pretty`/`pino-roll` falsely (they are loaded by name in `apps/api/src/logger.ts:6,13`).

**Fix**:
1. Add `knip` as a root devDependency.
2. Create `knip.json` with these workspaces. `apps/app`: entry `["src/main.jsx"]`, project `["src/**/*.{js,jsx}"]`. `apps/admin`: entry `["src/main.jsx"]`, project `["src/**/*.{js,jsx}"]`. `apps/api`: entry `["src/index.ts", "test/**/*.ts", "src/**/*.test.ts"]`, project `["src/**/*.ts", "test/**/*.ts"]`, `ignoreDependencies: ["pino-pretty", "pino-roll"]`. `packages/rbac`: entry `["index.js"]`. Root `.`: entry `["scripts/*.mjs"]`.
3. If Q1 keeps Spare Parts parked, add `"ignore": ["apps/app/src/pages/SpareParts.jsx"]` to the `apps/app` workspace, with a comment in the commit naming Q1. Do the same for `lib/db/spareParts.js` exports.
4. Add `"deadcode": "knip --no-progress"` to root scripts. Do not add it to `check` yet; add it in the same commit only if it exits 0.

**Siblings**: none.

**Must not break**: nothing at runtime.

**Verify**: `npm run deadcode` lists no unused files and no unused dependencies. Paste any remaining export findings into the commit body.

### TASK-0.5: Add a unit-test runner to the app and cover the pure helpers
- **Severity**: LOW
- **Category**: cleanup
- **Effort**: S
- **Depends on**: none
- **Finding**: RF-FE-31 (step 1)
- **Files**: `apps/app/package.json`, `apps/app/vitest.config.js` (new), `apps/app/src/lib/__tests__/errors.test.js`, `money.test.js`, `health.test.js`, `packages/rbac/rbac.test.js` (new files)

**Problem**: The app has no tests, so the shared helpers that Wave 4 centralises have nothing pinning their behaviour.

**Fix**:
1. Add `vitest` as an `apps/app` devDependency. Add `"test": "vitest run"`. Create `vitest.config.js` with `environment: 'node'` and include `src/**/*.test.{js,jsx}` plus `../../packages/rbac/*.test.js`.
2. `errors.test.js`: `errorText` returns the mapped sentence for a known code (pick 3 codes from `ERROR_MESSAGES` in `lib/errors.js`), the fallback for an unknown code, and the fallback for a non-Error value.
3. `money.test.js`: `fmtMoney` and `fmtMoneyExact` from `lib/money.jsx` (pure exports at `:44`, `:61`): NGN and USD codes, zero value, negative value, and `currencySymbol('USD')`.
4. `health.test.js`: `healthBand` boundaries at 30, 31, 50, 51 (constants `HEALTH_RED_MAX`, `HEALTH_YELLOW_MAX` in `lib/health.js:12-13`).
5. `rbac.test.js`: `can()` from `packages/rbac/index.js`. Check: a role cap allows; an `extraCaps` grant allows a cap the role lacks; `*:read` does not grant a cap in `EXPLICIT_ONLY_CAPS`; owner `*` allows `depreciation:manage`; unknown role denies.

**Siblings**: none.

**Must not break**: build unchanged (`vitest` is dev-only).

**Verify**: `npm test -w @assetcore/app` passes. Change `HEALTH_RED_MAX` to 29 temporarily: the health test goes red. Restore it.

---

## Wave 1: Dead code

### TASK-1.1: Remove the app's dead code
- **Severity**: LOW
- **Category**: cleanup
- **Effort**: M
- **Depends on**: TASK-0.2
- **Finding**: DC-FE-03, 06-23, 29, 30
- **Files**: `apps/app/src/pages/NotConfigured.jsx` (delete), `apps/app/src/App.jsx`, `apps/app/src/lib/apiClient.js`, `apps/app/src/lib/AuthContext.jsx`, `apps/app/src/lib/auth.js`, `apps/app/src/lib/health.js`, `apps/app/src/lib/money.jsx`, `apps/app/src/lib/db/{assets,complianceLicences,defects,devices,inspections,integrations,maintenanceEvents,pmSchedules,workOrders,org}.js`, `apps/app/src/pages/{Devices,Maintenance,Defects,Risks}.jsx`, `apps/app/src/components/{CompliancePanel,AssetQr,InspectionsPanel,SendForApproval}.jsx`, `apps/app/src/lib/{auditLabels,errors}.js`, `apps/app/src/lib/NotificationsContext.jsx`, `packages/ui/index.css`, `packages/rbac/index.js`

**Problem**: knip, a local-symbol scan and grep found unused code in the app (full evidence in `05a-dead-code-frontend.md`). Before deleting any symbol, re-run `grep -rnw <symbol> apps/app/src apps/admin/src`; at baseline each returned only its definition.

**Fix** (delete unless marked unexport):
1. `isConfigured`: delete `pages/NotConfigured.jsx`; in `App.jsx` remove the `isConfigured` import, the `NotConfigured` import and the `if (!isConfigured) return <NotConfigured />` line; in `AuthContext.jsx` remove the import, the `if (!isConfigured) {...}` block and the `!isConfigured ||` term; in `auth.js` remove the re-export; in `apiClient.js` remove `export const isConfigured = true` and its comment.
2. `auth.js`: delete `currentOrgId` and `signInWithSSO`.
3. `health.js`: delete `healthTextColor`; unexport `HEALTH_YELLOW_MAX`, `HEALTH_RED_MAX`. If TASK-0.5 imports them, keep the export and say so.
4. `money.jsx`: delete `CURRENCY_SYMBOL`; unexport `convert`; keep `fmtMoney` exported (TASK-0.5 tests it). Remove `base`, `secondary`, `fxRate`, `fxRateAt` from the `useMoney()` return object, keeping internal use.
5. Helpers with zero callers (Q4 keeps their API routes): `getAsset` (assets.js), `getComplianceLicenceCounts` (complianceLicences.js), `OPEN_STATUSES` (defects.js), `getLatestReadings` and `softDeleteDevice` (devices.js, and the `softDeleteDevice` import in `pages/Devices.jsx:6`), `getInspection`, `createInspectionTemplate`, `updateInspectionTemplate`, `retireInspectionTemplate` (inspections.js), `getIntegration` (integrations.js), `listMaintenanceCompletions`, `uploadMaintenanceCompletionReport` (maintenanceEvents.js), `updatePMSchedule` (pmSchedules.js), `softDeleteWorkOrder`, `listWorkOrderTasks`, `listWorkOrderParts`, `updateWorkOrderPart` (workOrders.js). Unexport `WO_STATUS_STYLE`, `WO_DRAFT_STYLE`.
6. `org.js`: route the three direct `api.patch('/org', ...)` calls (`Settings.jsx:236`, `:348`, `Onboarding.jsx:128`) through `updateOrg`, and fix the comment at `org.js:13-16` to match. (TASK-4.8 does the other direct calls.)
7. `CompliancePanel.jsx`: delete local `viewDocument` (`:174-177`) and the unused imports `useNavigate` (`:11`) and `licenceStatus` (`:18`). `Maintenance.jsx`: delete the `useRef` import, the `api` import line (`:14`) and `PRIORITY_COLOR` (`:29`).
8. `Defects.jsx` `DefectModal` and `Risks.jsx` `RiskModal`: drop the `prefill` prop and change `{ ...EMPTY, ...prefill }` to `{ ...EMPTY }`.
9. Unexport only: `assetQrValue` (AssetQr.jsx), `STATUS_META`, `KIND_META` (InspectionsPanel.jsx), `approvalErrorText`, `approverLabel` (SendForApproval.jsx), `ACTION_LABEL` (auditLabels.js), `ERROR_MESSAGES` (errors.js), `initialsOf` (AuthContext.jsx), `EXPLICIT_ONLY_CAPS` (packages/rbac/index.js; also remove it from `index.d.ts` if listed).
10. Context fields: remove `session` from the AuthContext `value` and `refresh` from the NotificationsContext `value`. Keep internal state.
11. `packages/ui/index.css`: delete `.btn-danger` (keep `.btn-danger-soft` and the shared comment) and `.kpi` (keep `.kpi-link`). Keep `.modal-overlay` and `.modal-card` for TASK-4.6.
12. Delete the empty untracked `supabase/` folder: `rmdir supabase/functions supabase/snippets supabase`. There is nothing to commit for this step.

**Siblings**: `apps/admin/src/App.jsx:22` and `apps/admin/src/lib/apiClient.js` have the same `isConfigured` pattern. Out of scope (rule 8); note it in the commit.

**Must not break**: sign-in, the dashboard, Devices, Maintenance, Compliance, Defects and Risks pages render; Settings org save still works through `updateOrg`.

**Verify**: `npm run lint -w @assetcore/app` shows 0 errors and fewer warnings than before (record both counts). `npm run build` passes. `npm test -w @assetcore/app` passes. Start the app, sign in, and open Devices, Maintenance, Compliance, Defects, Risks and Settings: no console errors. In Settings, change the organisation name, save, reload: the new name shows.

### TASK-1.2: Remove the API's dead code and the shadowed audit DELETE
- **Severity**: LOW
- **Category**: cleanup
- **Effort**: M
- **Depends on**: none
- **Finding**: DC-API-01, 07, 09, 10, 17, 19, DC-FE-31
- **Files**: `apps/api/src/routes/compliance.ts`, `apps/api/src/routes/inspections.ts`, `apps/api/src/routes/integrations.ts`, `apps/api/src/routes/workOrders.ts`, `apps/api/src/routes/approvals.ts`, `apps/api/src/auth/mailer.ts`, `apps/api/src/healthService.ts`, `apps/api/src/middleware/rbac.ts`, `apps/api/src/db.ts`, `apps/api/.env.example`, `apps/api/src/routes/admin/billing.ts`, the route files and modules listed in step 5

**Problem**: Endpoints and symbols nothing calls (evidence in `05b-dead-code-api.md`). `DELETE /compliance-audits/:id` is registered twice (`compliance.ts:207` and `:492`). Express runs the first, which has no `deleted_at is null` guard, so re-archiving an audit answers 204 and writes a second audit row. The stricter handler at `:492` never runs.

**Fix**:
1. Delete the first `complianceRouter.delete('/compliance-audits/:id', ...)` handler (baseline `compliance.ts:207-216`, the one whose query is `update public.compliance_audits set deleted_at = now() where id = $1 returning id, org_id`). Keep the one with `and deleted_at is null`. This is behaviour change Q6(g).
2. Delete these handlers. Before deleting each, grep `apps/app/src apps/admin/src apps/api/test docs scripts` for its path and confirm 0 callers: `GET /compliance-licences/counts` (compliance.ts:64-80), `GET /compliance-audits/stats` (:375-392), `GET /inspections/:id` (inspections.ts:361-378), `GET /integrations/:kind` (integrations.ts:19-24), `GET /work-orders/:id/tasks` (workOrders.ts:672-683), `GET /work-orders/:id/parts` (workOrders.ts:756-770).
3. `auth/mailer.ts`: delete `mailerConfigured` and its comment. `middleware/rbac.ts`: remove `ROLE_CAPABILITIES` from the re-export list.
4. `approvals.ts:321-323`: replace `(rbac as { ROLE_RANK?: ... }).ROLE_RANK ?? {}` with a named import `ROLE_RANK` from `@assetcore/rbac`.
5. Unexport (drop `export`; keep the symbol) each symbol knip lists for `apps/api/src` in `audit/code-cleanup-2026-10-05/knip-raw.txt` except `mailerConfigured` and `ROLE_CAPABILITIES`. That is: `NO_SITE`, `sniffMime`, `DEFECT_PENALTY`, `recomputeAssetHealth`, platform `hasCap`, the enum arrays in approvals, assets, compliance, defects, escalations, inspections, integrity and risks, `integrityStatusOf`, and the 11 types. If a test imports one, keep it exported.
6. `healthService.ts` `recomputeAllHealthScores(c, orgId?)`: TASK-1.3 starts passing `orgId`, so keep the parameter. Do nothing here.
7. Reword the Supabase-era comments at `db.ts:18`, `apps/api/.env.example:10` and `routes/admin/billing.ts:50` to describe the current design without mentioning Supabase. Do not touch migrations.

**Siblings**: the endpoints kept under Q4 (inspection-template CRUD, PATCH pm-schedules, DELETE work-orders, PATCH WO part, maintenance-completions GET and report POST, device DELETE and readings) stay.

**Must not break**: every remaining route; the compliance UI's archive action still works once.

**Verify**: `npm run build:api` and `npm run typecheck -w @assetcore/api` pass; API tests pass. Add a test in `apps/api/test/` (new file `compliance.test.ts`): create an audit as the fixture owner, `DELETE` it (204), `DELETE` again (404), and the audit log holds exactly one `compliance_audit.archive` row for it. Mutation check: restore the deleted handler, see the second DELETE return 204 and the test go red, then remove it again.

### TASK-1.3: Retire the old linear-decay health SQL
- **Severity**: LOW
- **Category**: backend
- **Effort**: M
- **Depends on**: TASK-1.2
- **Finding**: DC-API-11, DC-API-12, RF-API-29, OOS-17
- **Files**: `apps/api/src/cli/rescoreHealth.ts` (new), `apps/api/package.json`, `scripts/seed-dev.mjs`, `apps/api/test/health.test.ts`, `db/migrations/<NEXT>_drop_legacy_health_functions.sql` (new)

**Problem**: Production rescores health in TypeScript (`recomputeAllHealthScores`, `healthService.ts:188`, cron at `jobs.ts:21-25`). The old SQL `public.recompute_asset_health(uuid)` (latest at `0027:284`) and `public.recompute_asset_health_for(uuid, uuid)` (`0016:160`) are still called by `scripts/seed-dev.mjs:266`, so a dev seed scores health with the retired formula. They are also called by the "decay math" test (`test/health.test.ts:43-59`), which pins the retired model. `public.licence_status(date)` (`0001_baseline.sql:519`) is never called.

**Fix**:
1. Create `apps/api/src/cli/rescoreHealth.ts`. It imports `ownerPool` from `../db.js` and `recomputeAllHealthScores` from `../healthService.js`, accepts an optional org id as `process.argv[2]`, runs the recompute, prints `assets rescored: N`, and ends the pool. Add `"rescore:health": "tsx src/cli/rescoreHealth.ts"` to `apps/api/package.json`.
2. In `seed-dev.mjs`, delete the `select public.recompute_asset_health($1)` line. After the `commit`, run `execFileSync('npm', ['run', 'rescore:health', '-w', '@assetcore/api', '--', ORG], { stdio: 'inherit' })`. First check whether `apps/api/src/config.ts` needs env vars that seed-dev does not set: run the seed once. If config validation fails, pass `env: { ...process.env, ...<the vars from apps/api/.env> }` by loading `apps/api/.env` with `dotenv` (already a root dependency).
3. In `test/health.test.ts`, replace the "decay math" test with one that sets an asset's signals (follow the shape of the existing threshold tests in the same file), calls `recomputeAllHealthScores(ownerPool, ORG_A)`, and asserts the stored `health_score` equals `computeHealth(...)` for the same inputs.
4. Create the migration: `drop function if exists public.recompute_asset_health(uuid); drop function if exists public.recompute_asset_health_for(uuid, uuid); drop function if exists public.licence_status(date);`. Before writing it, grep `db/migrations` for any other function body that calls these three (at baseline: none besides `recompute_asset_health` calling `_for`) and any `grant` that would fail.

**Siblings**: `jobs.ts` names its cron job `recompute_asset_health`, which is the same name as the dropped SQL. Rename the job to `rescore_asset_health` in the same commit (it is only a log label).

**Must not break**: the nightly health job; `apply_asset_health()` (still live, do not drop); the threshold-crossing tests in `test/health.test.ts`.

**Verify**: `node scripts/migrate.mjs` on the dev DB, then `node scripts/seed-dev.mjs` completes and prints `assets rescored: N`. Then `psql -d assetcore -c "select count(*) from pg_proc where proname in ('recompute_asset_health','recompute_asset_health_for','licence_status')"` returns 0. API tests pass.

### TASK-1.4: Remove the documents registry, Reports API and platform invite
- **Severity**: LOW
- **Category**: cleanup
- **Effort**: M
- **Depends on**: TASK-1.2
- **Finding**: DC-FE-01, DC-FE-02, DC-API-02, DC-API-04, DC-API-05, DC-API-06, OOS-03, OOS-16 (decisions Q1, Q2, Q3, Q5)
- **Files**: `apps/app/src/components/DocumentsPanel.jsx` (delete), `apps/app/src/lib/db/documents.js` (delete), `apps/app/src/lib/db/spareParts.js`, `apps/api/src/routes/documents.ts` (delete), `apps/api/src/routes/reports.ts` (delete), `apps/api/src/reportBuilders.ts`, `apps/api/src/routes/index.ts`, `apps/api/src/routes/admin/users.ts`, `apps/api/test/uatRound2.test.ts`, `apps/api/test/uatRound3.test.ts`, `docs/OPERATIONS.md`

**Problem**: `DocumentsPanel` and the 4 `/documents` routes were ported in 5a413fa and never mounted. Files they store under `documents/` cannot be downloaded (no entry in `FILE_OWNERSHIP_CHECKS`, `files.ts:121-138`), and PATCH/DELETE have no capability check. The 4 `/reports` routes have had no UI caller since 913e934 replaced Reports with Export. `POST /admin/users/:id/invite` (`admin/users.ts:63-101`) has never had a caller, and it overwrites an existing user's role in the target org. Org create/suspend/restore (`admin/orgs.ts:36-81`) are kept for runbook use, but nothing documents them.

**Fix**:
1. Q2: delete `DocumentsPanel.jsx`, `lib/db/documents.js`, `routes/documents.ts`, and its `import` and `apiRouter.use(documentsRouter)` in `routes/index.ts`. Leave the `documents` table (TASK-1.6).
2. Q3: delete `routes/reports.ts` and its two lines in `routes/index.ts`. In `reportBuilders.ts`, delete `buildReportData`, `REPORT_KINDS` and `ReportKind` (baseline `:5-139`); keep `renderCsv`, `renderXlsx`, `localDateStamp` (used by `exports.ts`). Keep the `reports` entry in `files.ts` `FILE_OWNERSHIP_CHECKS` so old generated files still download. Delete the report tests in `test/uatRound2.test.ts:39-62` and `test/uatRound3.test.ts:94-130`. First check whether any assertion there covers something that still exists (for example the book-value redaction rule); if so, move that assertion to a test against `GET /api/exports/:dataset`, which uses the same redaction, and say so in the commit.
3. Q5: delete the `POST /users/:id/invite` handler from `routes/admin/users.ts`. Add a short "Platform runbook endpoints" section to `docs/OPERATIONS.md` listing `POST /api/admin/orgs`, `/orgs/:id/suspend`, `/orgs/:id/restore`: what each does, that it needs a platform admin token, and a curl example.
4. Q1: in `lib/db/spareParts.js`, delete `listMovements` only.
5. Search the whole repo for remnants: `grep -rniE "documentsRouter|DocumentsPanel|reportsRouter|/api/reports|buildReportData|users/:id/invite" apps docs scripts README.md`. List what you found and removed in the commit body.

**Siblings**: the `public.documents` and `public.reports` tables remain. TASK-1.6 handles `documents`; `reports` stays for old files.

**Must not break**: Export page downloads (it uses `renderCsv`/`renderXlsx`); per-asset and per-licence documents (`/assets/:id/documents`, `/compliance-licences/:id/document`); the backoffice Users page (disable, enable, reset password, role).

**Verify**: `npm run build`, `npm run build:api`, `npm run typecheck -w @assetcore/api`, lint and API tests pass. `curl -i localhost:8787/api/reports` with a valid token answers 404. In the app, download one export as XLSX and open it. In the backoffice, open Users: no console errors.

### TASK-1.5: One version source, and call the liveness router "system"
- **Severity**: LOW
- **Category**: cleanup
- **Effort**: S
- **Depends on**: TASK-1.2
- **Finding**: DC-API-09, RF-API-22, OOS-18
- **Files**: `apps/api/src/routes/health.ts` (rename to `system.ts`), `apps/api/src/routes/admin/version.ts`, `apps/api/src/version.ts` (new), `apps/api/src/routes/index.ts`, `apps/api/package.json`, `apps/api/test/system.test.ts` (new)

**Problem**: "health" names three unrelated things: asset health scoring (`health.ts`), its DB service (`healthService.ts`), and the liveness probe (`routes/health.ts`). `GET /api/version` and `GET /api/admin/version` are the same handler written twice, each reading `apps/api/package.json` (1.0.0) while the product is 1.1.0 (root `package.json`, CHANGELOG).

**Fix**:
1. Create `src/version.ts` exporting `APP_VERSION`, read once from `apps/api/package.json` (keep that file as the source because the Dockerfile copies it; `apps/api/Dockerfile:13`).
2. Rename `routes/health.ts` to `routes/system.ts` and the export to `systemRouter`. Keep both paths (`/health`, `/version`) and mount it in the same place in `routes/index.ts` (before the tenant routers; TASK-2.1 depends on that).
3. `routes/admin/version.ts`: use `APP_VERSION`.
4. Set `apps/api/package.json` `version` to the root version (`1.1.0`). Add `test/system.test.ts`: `GET /api/health` answers 200 without a token, and `GET /api/version` returns `version` equal to the root `package.json` version (read it in the test). This pins the two together.

**Siblings**: `scripts/support-bundle.mjs:66-67` and `docs/OPERATIONS.md:55-56` call these paths. They don't change.

**Must not break**: `/api/health` stays public; the backoffice dashboard version card.

**Verify**: API tests including the new one pass. Mutation check: set `apps/api/package.json` to `1.0.0` again, see the version test go red, and restore it.

### TASK-1.6: Drop the unused `sms_log` and `documents` tables
- **Severity**: LOW
- **Category**: backend
- **Effort**: S
- **Depends on**: TASK-1.4
- **Finding**: DC-API-13, DC-API-15
- **Files**: `db/migrations/<NEXT>_drop_unused_tables.sql` (new)

**Status**: BLOCKED (owner action 1)

**Problem**: `public.sms_log` (`0001_baseline.sql:727`) is never read or written. `public.documents` (`0021`) loses its only writer in TASK-1.4. Dropping a table with rows loses data, so the production row count decides.

**Fix**:
1. If the owner reports 0 rows for a table, the migration drops it: `drop table if exists public.sms_log;` and/or `drop table if exists public.documents;`. Grep `db/migrations` for policies, grants, views or functions that reference each table, and drop those first in the same migration.
2. If a table has rows, do not drop it. Write `docs/OPERATIONS.md` a line saying the table is retained read-only and why, and close the task for that table.

**Siblings**: `reports` table stays (Q3).

**Must not break**: migrate on a fresh DB and on a DB at the previous migration.

**Verify**: `node scripts/migrate.mjs` on a fresh `assetcore_test` and on the dev DB, then API tests pass. Confirm with `\dt public.sms_log` in psql that the table is gone.

---

## Wave 2: API foundations

### TASK-2.1: Check auth and membership once per request
- **Severity**: MEDIUM
- **Category**: backend
- **Effort**: M
- **Depends on**: Wave 1
- **Finding**: RF-API-01, B3, B21
- **Files**: `apps/api/src/routes/index.ts`, every tenant router file with the line `<x>Router.use(requireAuth, requireOrg, requireActiveMembership)` (28 at baseline: analytics, approvals, audit, categories, assets, compliance, defects, depreciation, dashboard, devices, exports, escalations, integrations, inspections, integrity, licence, locations, maintenanceEvents, org, pmSchedules, notifications, risks, spareParts, pmTasks, workOrders, sites, and documents/reports if not yet deleted), `apps/api/src/routes/orgMembers.ts`, `apps/api/src/routes/profile.ts`, `apps/api/src/files.ts`, `apps/api/src/app.ts`, `apps/api/test/gateOnce.test.ts` (new)

**Problem**: `routes/index.ts:40-70` mounts each router at the root of `/api` with no prefix. Each router starts with a pathless `router.use(requireAuth, requireOrg, requireActiveMembership)`. Express runs a pathless `use` for every request that enters the router, so a request is gated again by every router it passes on the way to its own. `requireActiveMembership` (`middleware/requireActiveMembership.ts:24-37`) runs an owner-pool query on every non-GET, so a write to a late router runs it about 28 times. The declared gates also lie: `profile.ts:9` declares `requireAuth` only but actually inherits the full gate from `sitesRouter`. `/api/health` is public only because it is mounted first. Any unknown `/api/...` path answers 401 instead of 404.

**Fix**:
1. In `routes/index.ts`, mount in this order: `apiRouter.use('/auth', authRouter)`, `apiRouter.use('/admin', adminRouter)`, `apiRouter.use(systemRouter)` (public). Then `apiRouter.use(requireAuth)`, `apiRouter.use(profileRouter)` (decision: profile needs auth but not an org; this is its declared behaviour), then `apiRouter.use(requireOrg, requireActiveMembership)`, then every tenant router in the current order.
2. Delete the pathless `router.use(requireAuth, requireOrg, requireActiveMembership)` line from each tenant router file. In `profile.ts`, delete its `use(requireAuth)`.
3. `orgMembers.ts:24`: keep only `requireCap('user:manage')` on its path-scoped `use('/org/members', ...)`, since the parent now gates.
4. `files.ts`: `filesRouter` is mounted on `app` after `apiRouter` (`app.ts:34`). Move its mount inside `routes/index.ts` after the tenant gate, delete its per-route `requireAuth` and its inline org check if it only duplicates `requireOrg` (read `files.ts:145-166` first; keep any check that compares the path's org id to the caller's org).
5. In `app.ts`, check the 404 handler now answers unknown `/api/*` paths for unauthenticated callers. If the tenant gate answers 401 first, mount a catch-all `apiRouter.use((req, res) => res.status(404).json({ error: 'not_found' }))` as the last line of `routes/index.ts`.

**Siblings**: `routes/admin/index.ts:19-20` has the same ordering trick for `meRouter` (public before `requirePlatformAdmin`). Leave it as is, and add a comment there that order matters.

**Must not break**: every existing test, in particular `test/rbac.test.ts`, `test/trustProxy.test.ts` (rate-limited login), and the disabled-member checks in `test/attributionAndAudit.test.ts`. `/api/health` and `/api/version` stay public.

**Verify**: API tests pass. New `test/gateOnce.test.ts`:
(a) spy on `ownerPool.query` (`vi.spyOn`), send one `POST` to an endpoint mounted late (for example create an escalation rule as the owner), and assert the membership query (match on `from public.users u` SQL text) ran exactly once;
(b) `GET /api/health` without a token is 200;
(c) `GET /api/does-not-exist` without a token is 404;
(d) a disabled member's `POST` is 403 `account_disabled`.
Mutation check: re-add the blanket line to one late router and see (a) go red.

### TASK-2.2: Put a capability check on every tenant route, and test it stays that way
- **Severity**: HIGH
- **Category**: security
- **Effort**: M
- **Depends on**: TASK-2.1
- **Finding**: RF-API-01b, OOS-01, OOS-03, OOS-21, RF-API-03
- **Files**: `apps/api/src/routes/integrations.ts`, the route files for the reads listed in step 3, `packages/rbac/index.js`, `packages/rbac/index.d.ts`, `apps/api/test/routeGates.test.ts` (new)

**Problem**: `PUT /integrations/:kind` (`integrations.ts:32`) has no `requireCap`, and RLS on `integrations` checks org only (`0001_baseline.sql:977-979`). So any active member, a viewer included, can rewrite SAP/Termii settings with a direct call; only the UI checks `integration:manage` (`Integrations.jsx:206`). This is the same class as the July audit's C1, fixed for sites/locations/categories but not for siblings. Many reads also skip `requireCap` while their neighbours use it (list in `05d-refactor-api.md` RF-API-01b), so the next role change will open or close them by accident.

**Fix**:
1. `integrations.ts`: add `requireCap('integration:manage')` to `PUT /integrations/:kind` and to `GET /integrations`. There is no `integration:read` capability at baseline (`grep -n integration packages/rbac/index.js`), and the UI shows the edit form only to `integration:manage` (`Integrations.jsx:206`). Check with `grep -rn listIntegrations apps/app/src` which pages read the list; if a page other than Integrations reads it for a non-owner role, put `GET /integrations` on the step-4 allow-list instead of gating it, and say so in the commit.
2. In `packages/rbac/index.js`, export `CAPABILITIES`, a frozen array of every capability string used by the API and app (gather with `grep -rhoE "requireCap\('[a-z_]+:[a-z_]+'\)" apps/api/src | sort -u`, plus the strings in the role map, plus `depreciation:manage` and `integration:manage`). Type it in `index.d.ts` as `export type Capability = typeof CAPABILITIES[number]`, and change `requireCap(capability: Capability)` in `middleware/rbac.ts`.
3. For each tenant read with no `requireCap` (`GET /work-orders`, `/work-orders/:id`, `/assets*`, `/pm-schedules`, `/pm-tasks`, `/inspections`, `/inspection-templates`, `/compliance-licences*`, `/devices*`, `/dashboard/*`, `/analytics/asset-map`, `/analytics/calendar`, `/exports`, `/integrity/overview`, `/categories`, `/locations*`, `/sites`, `/notifications*`, `/licence`, `/org`), add the `:read` cap of its entity, **only when every role that can reach that page today holds it**. Check with `can(role, cap)` for every role key in `ROLE_KEYS`. Where a role would lose access (at baseline: `compliance:read` for supervisor and officer on `/compliance-licences`, OOS-21), do not add the cap. Put the route on the allow-list in step 4 with the reason "pending owner decision OOS-21".
4. New `test/routeGates.test.ts`: walk the Express stack of `apiRouter` (`app._router` / `router.stack`, recursing into sub-routers). For every tenant route (any route registered after the tenant gate), assert at least one layer in its stack has the name `requireCapMiddleware` (give `requireCap`'s returned function that name in `middleware/rbac.ts`). Allow-list `GET /org/users`, `/notifications*`, `/licence`, `GET /org`, `/profile`, `/files/*`, `/locations/mine`, each with a one-line reason. Any other route without a cap fails the test with its method and path.
5. Integration test: as the fixture viewer, `PUT /api/integrations/sap` answers 403; as the owner it answers 200.

**Siblings**: `documents.ts` is deleted in TASK-1.4. If Q2 changed and it was kept, gate `PATCH`/`DELETE /documents/:id` here with the parent's update cap.

Also remove `report:create` from `packages/rbac` (role map and `GRANTABLE_CAPS`) and its label in `Admin.jsx` (`CAP_LABELS`): since TASK-1.4 deleted `POST /reports` it gates nothing. Before removing it from `GRANTABLE_CAPS`, check `orgMembers.ts` validates `extra_caps` against that list; if it does, a member who already holds the grant would fail a later access save, so strip it from stored grants in the same commit with a migration (`update public.memberships set extra_caps = array_remove(extra_caps, 'report:create')`, adjusted to the column's real type).

**Must not break**: every page each role sees today. Run the API tests, then sign in as the seeded owner and check Dashboard, Assets, Work Orders, Maintenance, Compliance and Integrations load.

**Verify**: API tests including both new ones pass. Mutation check: remove the cap from `PUT /integrations/:kind`; both the viewer test and `routeGates.test.ts` go red. Restore it.

### TASK-2.3: One way to read the caller's live role
- **Severity**: MEDIUM
- **Category**: backend
- **Effort**: S
- **Depends on**: TASK-2.1
- **Finding**: RF-API-02, OOS-08
- **Files**: `apps/api/src/claims.ts`, `apps/api/src/middleware/rbac.ts`, `apps/api/src/routes/approvals.ts`, `apps/api/src/routes/orgMembers.ts`, `apps/api/test/directApprovals.test.ts`

**Problem**: `requireActiveMembership` loads the live role into `req.membership`. `claimsFromReq` (`claims.ts:9-16`) and `hasCap` (`middleware/rbac.ts:28-32`) prefer it. But `approvals.ts` re-implements this as `callerCan` (`:229-235`) and `roleOf` (`:730`), and inline at `:248, :286, :388, :491`. It also reads the JWT role directly at `:422, :508-509, :516, :607, :620, :668`. The JWT role can be 60 minutes stale. So a just-demoted approver passes the cap check with the live role and then the "is it waiting on you" check with the old one (or the reverse). `orgMembers.ts:50-52` has a fifth copy (`callerIsOwner`).

**Fix**:
1. In `claims.ts`, export `effectiveRole(req): string | null` (`req.membership?.role_key ?? req.claims?.role_key ?? null`), `effectiveCaps(req): string[]` (`req.membership?.extra_caps ?? req.claims?.extra_caps ?? []`) and `isOwner(req)`. Read the `req.membership` type in `types/express.d.ts` first and use its real field names.
2. In `middleware/rbac.ts`, make `hasCap` use them; add `hasAnyCap(req, caps)` and `requireAnyCap(...caps)`.
3. Replace `callerCan`, `roleOf`, `callerIsOwner` and every `req.claims!.role_key` / `req.claims?.role_key` in `routes/` with these helpers. Replace the hand-rolled OR gate at `approvals.ts:301-304` with `requireAnyCap(...)`.
4. Run `grep -rn "claims[!?]\.role_key" apps/api/src/routes` and expect 0.

**Siblings**: `routes/documents.ts:70` `can(req.claims?.role_key, cap)` (deleted in TASK-1.4; if it was kept, fix it here).

**Must not break**: approval flows in `test/directApprovals.test.ts` and `test/uatRound3.test.ts`.

**Verify**: API tests pass. New test in `directApprovals.test.ts`: user X holds the approver role; log X in; demote X with `PATCH /org/members/:id/role` as the owner; X's still-valid token then tries to approve and gets 403. Mutation check: revert the approve path to `req.claims!.role_key` and see the test go red.

### TASK-2.4: Owner-pool transaction helpers; rewrite member management on them
- **Severity**: MEDIUM
- **Category**: backend
- **Effort**: M
- **Depends on**: TASK-2.3
- **Finding**: RF-API-05, RF-API-06, RF-API-17, OOS-13, B11, B12
- **Files**: `apps/api/src/db.ts`, `apps/api/src/routes/orgMembers.ts`, `apps/api/src/auth/routes.ts`, `apps/api/test/rbac.test.ts`

**Problem**: Tenant code uses `withOrgContext`, but owner-pool code hand-rolls transactions. `orgMembers.ts:97-297` has 15 early-return `await client.query('rollback'); return res...` lines. One missed rollback returns a connection to the pool mid-transaction. `countActiveOwners` (`:36-42`) and `getOrgMembership` (`:55-63`) query `ownerPool` directly, outside the open transaction and with no lock, so two concurrent demotions can remove both remaining owners. Invite sends mail before commit (`:136-152`). Password reset and change update the password and revoke refresh tokens in separate autocommit statements (`auth/routes.ts:242-256`, `:273-282`). `orgMembers.ts:217-224` hand-builds a SET clause.

**Fix**:
1. In `db.ts`, add `withOwnerTx<T>(fn: (c: PoolClient) => Promise<T>)`: connect, begin, run, commit, rollback on throw, always release. Add `withOwnerClient<T>(fn)`: connect, run, release.
2. Rewrite each `orgMembers.ts` handler so the callback returns `{ error: '<code>' }` or data, and the handler maps that to HTTP after the transaction (as tenant routes do). Remove every manual `rollback`.
3. Change `countActiveOwners(c, orgId)` and `getOrgMembership(c, ...)` to take the transaction client. In the role-change and disable paths, lock the org's owner memberships first with `select id from public.memberships where org_id = $1 and role_key = 'owner' and status = 'active' for update`, then count.
4. Invite: send the email after the transaction commits. Fix the invite's audit row to use the membership id as `entityId` (`entityType: 'membership'`).
5. `auth/routes.ts`: password reset and change run their update and revoke inside one `withOwnerTx`. The other bare connect/release blocks use `withOwnerClient`.
6. Replace the hand-built SET at `orgMembers.ts:217-224` with `buildSet` after normalising `extra_caps` (`if ('extra_caps' in d) d.extra_caps ??= []`).

**Siblings**: `routes/admin/users.ts:70-100` has the same pattern on the platform side. Out of scope (rule 8); note it in the commit.

**Must not break**: invite, role change, access change, disable/enable, reset password; last-owner protection; login and refresh.

**Verify**: API tests pass. Add to `test/rbac.test.ts`: in an org with exactly two owners, fire two `PATCH /org/members/:id/role` demotions at once (`Promise.all`), each demoting the other owner. Exactly one succeeds and one answers the last-owner error; afterwards the org has one active owner. Mutation check: remove the `for update` lock and run the test 10 times. If it never goes red, note that in the commit (the race window may be too narrow to reproduce locally) and keep the lock anyway.

### TASK-2.5: One upload pipeline for all upload routes
- **Severity**: MEDIUM
- **Category**: security
- **Effort**: M
- **Depends on**: TASK-2.1
- **Finding**: RF-API-14, OOS-04
- **Files**: `apps/api/src/files.ts`, `apps/api/src/routes/{assets,maintenanceEvents,workOrders,pmTasks,inspections,compliance}.ts`, `apps/api/test/uploads.test.ts` (new)

**Problem**: Ten upload routes repeat the same steps by hand: multer, `missing_file`, URL building, clean-up on throw, clean-up on not found. Four apply `guardedSingle` (size limit answers 400) and `validateUploadOrCleanup` (magic-byte sniffing). Six do neither: `POST /work-orders/:id/attachments` (`workOrders.ts:585`), `/pm-tasks/:id/report` (`pmTasks.ts:174`), `/inspections/:id/report` (`inspections.ts:239`), `/compliance-licences/:id/document` (`compliance.ts:127`), `/compliance-audits/:id/document` (`compliance.ts:184`), and `/documents` (deleted in TASK-1.4).

**Fix**:
1. In `files.ts`, add `uploadRoute(opts: { subdir: string; field: string; mime: readonly string[]; maxBytes?: number }, handler: (req, res, file: { url: string; name: string; size: number; mime: string }) => Promise<unknown>)`. It returns an array of middleware plus handler: `guardedSingle(...)`, the `missing_file` check, `validateUploadOrCleanup` against `opts.mime`, then the handler. It cleans up the stored file if the handler throws or answers 404. Read how the four correct routes call `guardedSingle` and `validateUploadOrCleanup` and keep the same order.
2. Move all nine remaining upload routes onto it. For the mime list of each newly checked route, use the list the nearest correct sibling uses: reports and documents use the `maintenance-completions` report list; attachments use the asset documents list plus images.
3. Store the sniffed mime, not `req.file.mimetype`.

**Siblings**: grep `upload.single(`, `uploadTo(` and `multer(` across `apps/api/src`. After this task, every hit is inside `files.ts`.

**Must not break**: every existing upload from the app (asset photo and document, WO attachment, PM report, inspection report, licence document, audit document, maintenance completion). This is behaviour change Q6(c): a renamed `.exe` is now refused.

**Verify**: API tests pass. New `test/uploads.test.ts`, one case per route: a valid small PDF or PNG answers 201; a text file renamed `.pdf` answers 400 `invalid_file_type` (use the code `validateUploadOrCleanup` returns); a file over the limit answers 400 `file_too_large` (same). Mutation check: remove `validateUploadOrCleanup` from `uploadRoute` and see the renamed-file cases go red.

### TASK-2.6: Answer client mistakes with 4xx, not 500
- **Severity**: LOW
- **Category**: backend
- **Effort**: S
- **Depends on**: TASK-2.1
- **Finding**: RF-API-13, OOS-14
- **Files**: `apps/api/src/app.ts`, `apps/api/test/errors.test.ts` (new)

**Problem**: The error middleware (`app.ts:41-44`) logs and answers `500 internal_error` for everything. Malformed JSON (400 from `express.json()`), oversized bodies (413), a non-uuid id in a path (`22P02`), unique violations (`23505`) and FK violations (`23503`) all become 500 and log at error level.

**Fix**: In the error middleware: if `err.status` or `err.statusCode` is 400-499, answer that status with `{ error: err.type === 'entity.parse.failed' ? 'invalid_json' : err.status === 413 ? 'payload_too_large' : 'invalid_request' }` and log at `warn`. Map pg codes: `22P02` → 400 `invalid_request`, `23505` → 409 `conflict`, `23503` → 422 `invalid_reference`, `23514` → 422 `invalid_request`. Everything else stays 500.

**Siblings**: the app's `lib/errors.js` `ERROR_MESSAGES`: add sentences for `invalid_json`, `payload_too_large`, `conflict`, `invalid_reference` if missing.

**Must not break**: real 500s still log at error level with the stack.

**Verify**: new `test/errors.test.ts`: `GET /api/assets/not-a-uuid` → 400 (or 404 if the route already handles it; assert not 500); `POST /api/sites` with body `{` and `content-type: application/json` → 400 `invalid_json`; creating two categories with the same unique name (check the `asset_categories` unique constraint first) → 409. Behaviour change Q6(d).

### TASK-2.7: Make SQL "today" the instance's date in every route
- **Severity**: LOW
- **Category**: backend
- **Effort**: S
- **Depends on**: TASK-2.1
- **Finding**: RF-API-33, OOS-12
- **Files**: `apps/api/src/db.ts`, `apps/api/src/routes/exports.ts`, `apps/api/test/timezone.test.ts` (new)

**Problem**: `exports.ts:627` sets `set_config('TimeZone', config.TZ, true)` in its transaction so `current_date` is the instance's date. `withOrgContext` (`db.ts:45-50`) does not. The other 26 `current_date` uses in 10 route files run in the DB server's zone (UTC in `deploy/docker-compose.yml`). Between 00:00 and 01:00 Lagos time, the dashboard's "overdue" and the export's "overdue" disagree.

**Fix**: Add `'TimeZone', config.TZ` to the `set_config` calls in `withOrgContext`, and delete the one in `exports.ts`. Do the same in `withOwnerTx`/`withOwnerClient` (TASK-2.4) if it has landed; otherwise note it there.

**Siblings**: SQL cron functions run through `jobs.ts` on the owner pool: check whether `jobs.ts` sets the zone. If not, set it in its connection the same way and list it in the commit.

**Must not break**: export date filters.

**Verify**: new test: inside `withOrgContext`, `select current_setting('TimeZone')` equals `config.TZ` (`Africa/Lagos` in tests). Behaviour change Q6(f).

### TASK-2.8: Safe reference numbers for defects, risks and audits
- **Severity**: MEDIUM
- **Category**: backend
- **Effort**: M
- **Depends on**: TASK-2.1
- **Finding**: RF-API-19, OOS-06
- **Files**: `db/migrations/<NEXT>_ref_counters.sql` (new), `apps/api/src/refs.ts` (new), `apps/api/src/routes/defects.ts`, `apps/api/src/routes/risks.ts`, `apps/api/src/routes/compliance.ts`, `apps/api/src/routes/workOrders.ts`, `apps/api/test/refs.test.ts` (new)

**Problem**: Work orders get refs from a counter table (`next_wo_ref`, `0011_wo_ref_counter.sql:17-51`). Defects (`defects.ts:76-80`), risks (`risks.ts:69-72`), audits (`compliance.ts:352-355`) and defects raised from findings (`compliance.ts:594-596`) use `select count(*) ... where ref like 'XXX-<year>-%'` + 1. Concurrent creates collide on `unique (org_id, ref)` and answer 500. Audit refs are counted through site-scoped RLS (`0005_compliance_iso.sql:55-56`), so once another site has audits that year, a site-scoped creator collides every time. The year comes from Node's clock, not the DB's.

**Fix**:
1. Migration: create `public.ref_counters (org_id uuid, prefix text, year int, next_seq int, primary key (org_id, prefix, year))` with RLS enabled and no policies for `assetcore_app`. Create `public.next_ref(p_org uuid, p_prefix text) returns text`, `security definer`, `set search_path = public`, using the same upsert-and-return pattern as `next_wo_ref`, the year from `extract(year from now() at time zone current_setting('TimeZone'))`, and output format `PREFIX-YYYY-NNNN` (match the existing ref padding: read a sample ref in `test/` or seed). Backfill: for each prefix `DEF`, `RSK`, `AUD`, insert the current max sequence per org and year from existing refs. Grant execute to `assetcore_app`.
2. `refs.ts`: `nextRef(c, prefix: 'DEF' | 'RSK' | 'AUD')` calls `select public.next_ref(current_org_id(), $1)`.
3. Replace the four count-based generators with `nextRef`. Leave `generateWoRef` as is (already safe), but move it to `refs.ts` as `nextWoRef` so all ref code is in one place.

**Siblings**: grep `count(\*)` together with `ref like` across `apps/api/src`; after this task, 0 hits.

**Must not break**: existing refs stay unique; new refs continue each sequence without reusing numbers.

**Verify**: `test/refs.test.ts`: 10 concurrent `POST /api/defects` as the owner all answer 201 with 10 distinct refs. As a site-scoped fixture user, create an audit when another site already has one this year: 201 and a fresh ref. Mutation check: point `defects.ts` back at the count-based generator and see the concurrency test go red.

### TASK-2.9: Send approval notifications through the notify helpers
- **Severity**: LOW
- **Category**: backend
- **Effort**: S
- **Depends on**: TASK-2.3
- **Finding**: RF-API-24, OOS-15
- **Files**: `apps/api/src/routes/approvals.ts`, `apps/api/src/approvalRouting.ts`, `apps/api/src/notify.ts`, `apps/api/test/directApprovals.test.ts`

**Problem**: Every approval notification is a raw `insert into public.notifications`, via `notifyRole` (`approvals.ts:194-206`), `notifyUser` (`:208-219`) and a byte-identical `notifyApprovalUser` (`approvalRouting.ts:55-66`). They skip preferences, actor exclusion, de-duplication and `actor_id`, which `notify_users` / `notify_role_holders` provide (`notify.ts`).

**Fix**: Delete all three. Call `notifyUsers` / `notifyRoleHolders` from `notify.ts` with `entityType: 'approval'`, the approval id, the same title and body text, and `dedupe` key `approval:<id>:<level or step>:<event>`. Pass `null` for the site filter (approvals have no site column). Read `notify.ts` for the exact parameter names.

**Siblings**: grep `insert into public.notifications` across `apps/api/src`. After this task, the only hits are inside SQL functions.

**Must not break**: the people who are notified today still are, except a user who turned off that notification type, and the actor themself (behaviour change Q6(b)).

**Verify**: update `test/directApprovals.test.ts` expectations. Add one case: the approver turns off approval notifications in preferences, an approval is submitted, and no notification row is created for them. API tests pass.

### TASK-2.10: Move membership resolution out of the auth router
- **Severity**: LOW
- **Category**: cleanup
- **Effort**: S
- **Depends on**: TASK-2.4
- **Finding**: RF-API-04
- **Files**: `apps/api/src/auth/membership.ts` (new), `apps/api/src/auth/routes.ts`, `apps/api/src/middleware/requireActiveMembership.ts`

**Problem**: `requireActiveMembership.ts:3` imports `resolveSiteIds` from `auth/routes.ts:78`, so middleware depends on a router file and loads its rate limiters and mailer.

**Fix**: Move `resolveSiteIds`, `resolveOrgRole` and `NO_SITE` (`auth/routes.ts:43-93`) to `auth/membership.ts`, and import them from there in both files.

**Siblings**: grep `from '../auth/routes.js'` across `apps/api/src`. After this task, only `routes/index.ts` imports the router.

**Must not break**: login, refresh, scoped users' site lists.

**Verify**: API tests pass; `npm run typecheck -w @assetcore/api` passes.

### TASK-2.11: Add request helpers for parsing, result mapping and list queries
- **Severity**: LOW
- **Category**: backend
- **Effort**: M
- **Depends on**: TASK-2.1
- **Finding**: RF-API-10, RF-API-12, RF-API-26
- **Files**: `apps/api/src/http/validate.ts`, `apps/api/src/http/result.ts`, `apps/api/src/http/query.ts`, `apps/api/src/http/zod.ts` (all new), `apps/api/src/http/http.test.ts` (new), `apps/api/src/routes/devices.ts`, `apps/api/src/routes/notifications.ts`, `apps/api/src/routes/pmTasks.ts`, `apps/api/src/routes/inspections.ts`

**Problem**: 82 copies of `safeParse` then `400 invalid_request` (the issue list is thrown away). Results are mapped to HTTP three ways. 17 copies of the `YYYY-MM-DD` regex. List endpoints hand-parse query strings, and five take unbounded `limit` values, including negatives that 500 (`devices.ts:114`, `notifications.ts:13`, `pmTasks.ts:51`, `inspections.ts:83`; `reports.ts` is deleted).

**Fix**:
1. `http/zod.ts`: `isoDate`, `uuid`, `moneyCents`, `blankToUndefined` (move from `maintenanceEvents.ts:22`).
2. `http/validate.ts`: `parseOr400(schema, value, res)` returns the data, or `undefined` after answering `400 { error: 'invalid_request', fields: parsed.error.flatten().fieldErrors }`.
3. `http/result.ts`: promote `DIRECT_HTTP_STATUS` / `sendDirect` from `approvals.ts:708-728` into `send(res, result, statusFor, okStatus)`, plus a shared `ERROR_STATUS` table (`not_found: 404`, `forbidden: 403`, `site_shutdown: 422`, `not_pending: 409`, and the other codes in `approvals.ts`'s table).
4. `http/query.ts`: `listQuery(shape)` (zod object with `limit` 1-500 default 100, `offset` ≥ 0 default 0, plus the shape), and the `Where` builder lifted from `exports.ts:64-90`, with `inLocation(col, locationId)` for the location sub-select typed 11 times.
5. Adopt `listQuery` now in the four unbounded routes only. Every other file adopts these helpers when Wave 5 splits it (section 0 rule: "when you touch a route file, use the http helpers in it").
6. Unit tests in `http.test.ts` for each helper.

**Siblings**: the remaining 78 `safeParse` copies, adopted per file in Wave 5.

**Must not break**: the four list endpoints answer the same rows for the same queries the app sends today (check each `lib/db` caller's params). The new `fields` key in 400 bodies is additive.

**Verify**: unit tests pass. `GET /api/notifications?limit=-1` answers 400, not 500. API tests pass.

---

## Wave 3: One copy of each value list

### TASK-3.1: Shared value lists in `packages/domain`, used by the API
- **Severity**: MEDIUM
- **Category**: backend
- **Effort**: M
- **Depends on**: Wave 2
- **Finding**: RF-API-09, RF-FE-22
- **Files**: `packages/domain/{package.json,index.js,index.d.ts}` (new), `apps/api/package.json`, `apps/app/package.json`, `apps/api/src/routes/{workOrders,defects,escalations,assets,compliance,inspections,risks,approvals,integrity,analytics}.ts`, `apps/api/src/depreciation.ts`

**Problem**: About 10 value lists exist as API `as const` arrays and again as app tuples, and are retyped inside the API: priority at `workOrders.ts:113`, `defects.ts:218`, `escalations.ts:51`; defect severity at `compliance.ts:571`, `escalations.ts:52`; WO type at `workOrders.ts:111`, `defects.ts:221`; inspection kinds at `inspections.ts:29` and `:52`. Two different lists are both exported as `DEPRECIATION_METHODS` (`routes/assets.ts:61` includes `none`; `depreciation.ts:10` includes `units_of_production`). Nothing keeps the copies in step.

**Fix**:
1. Create `packages/domain` the same way as `packages/rbac` (`"name": "@assetcore/domain"`, `type: module`, `main`/`types`/`exports`). Export frozen arrays: `PRIORITIES`, `WO_TYPES`, `WO_STATUSES`, `WO_TRANSITIONS` (object), `DEFECT_SEVERITIES`, `DEFECT_STATUSES`, `DEFECT_OPEN_STATUSES`, `RISK_CATEGORIES`, `RISK_STATUSES`, `RISK_LIVE_STATUSES`, `ESCALATION_ENTITY_TYPES`, `ESCALATION_TRIGGERS`, `VALID_TRIGGERS`, `APPROVAL_ENTITY_TYPES`, `APPROVAL_KINDS`, `AUDIT_KINDS`, `AUDIT_OUTCOMES`, `FINDING_SEVERITIES`, `INSPECTION_KINDS`, `CHECKLIST_RESULTS`, `INTEGRITY_STATUSES` (order matters), `ASSET_STATUSES`, `LIFECYCLE_STATUSES`, `CRITICALITIES`, `ASSET_DEPRECIATION_METHODS` (the assets.ts list), `SCHEDULE_DEPRECIATION_METHODS` (the depreciation.ts list). Copy each value exactly from the API file at baseline, and type them `readonly [...]` in `index.d.ts`.
2. Add `"@assetcore/domain": "*"` to both apps' dependencies and run `npm install`.
3. Replace every API definition and inline retype with imports (`z.enum(PRIORITIES)`). Delete the local arrays.
4. Before committing, run `grep -rnE "'(low|minor|corrective|straight_line)'" apps/api/src/routes` and check that each remaining hit is a value in use, not a list.

**Siblings**: SQL check constraints in migrations hold the same lists. Do not change them. Add a test in `apps/api/test/domain.test.ts` that reads the check constraint for 3 columns (`work_orders.priority`, `defects.severity`, `assets.status`) from `pg_constraint` and asserts its values equal the package list.

**Must not break**: every validation accepts and refuses the same values as before.

**Verify**: API tests, typecheck and the new domain test pass. Mutation check: add `'urgent'` to `PRIORITIES`; the domain test goes red.

### TASK-3.2: App labels and tones keyed by the shared lists; one status badge
- **Severity**: MEDIUM
- **Category**: frontend
- **Effort**: M
- **Depends on**: TASK-3.1, TASK-0.5
- **Finding**: RF-FE-21, RF-FE-22, RF-FE-24, B10 (decision Q7)
- **Files**: `apps/app/src/lib/domain.js` (new), `apps/app/src/components/StatusBadge.jsx`, `apps/app/src/lib/db/{workOrders,defects,risks,escalations,approvals,complianceLicences,inspections,depreciation,integrity}.js`, `apps/app/src/pages/{Analytics,Assets,Maintenance,Scan,Integrations}.jsx`, `apps/app/src/components/{AssetMap,InspectionsPanel}.jsx`, `apps/app/src/lib/__tests__/domain.test.js` (new)

**Problem**: Status, priority and entity maps are copied across files and have started to differ. WO priority colours differ between `lib/db/workOrders.js:32` (low = grey) and `Assets.jsx:901` `PRIORITY_C` (low = green). Analytics (`Analytics.jsx:16-22`) writes "In progress" / "Awaiting parts" where the rest says "In Progress" / "Awaiting Parts". Asset status has three vocabularies (`Assets.jsx:41`, `AssetMap.jsx:29`, `Scan.jsx:12`). The per-asset depreciation picker (`Assets.jsx:276`) has no label for `sum_of_years_digits`. There are two pill systems (`StatusBadge` tone objects vs `.badge-*` classes) and a second component named `StatusBadge` in `Integrations.jsx:72`.

**Fix**:
1. `lib/domain.js`: for each list in `@assetcore/domain` that the app shows, export a meta map `{ [value]: { label, tone } }`, where tone is `good | warn | bad | info | neutral | draft`. Take labels from `lib/db/*.js` (the majority casing, "In Progress"). WO priority low uses tone `neutral` (grey, Q7). Export `ENTITY` meta (label + route) merged from `lib/notificationLink.js:13,23`, `Calendar.jsx:16`, `Dashboard.jsx:22`, `lib/db/approvals.js:3`, `lib/db/escalations.js:3`.
2. `StatusBadge.jsx`: take `tone` and render `<span className={'badge badge-' + TONE_CLASS[tone]}>`, mapping tones to the existing `.badge-g/-a/-r/-b/-n` classes. Keep the current props working by mapping old tone objects to names during migration, and remove that mapping at the end of the task.
3. Replace `PRIORITY_C`, `PM_STATUS_C`, `INSP_STATUS_C`, `STATUS_STYLE` (Assets), `PRIORITY_COLOR` and the status labels (Analytics), `TASK_STATUS` (Maintenance), `STATUS_CLASS` (Scan), `STATUS_COLOR` (AssetMap), `STATUS_META`/`KIND_META` (InspectionsPanel), and the local `StatusBadge` in Integrations (rename that one `ConnectionBadge` if it is not a status), each with imports from `lib/domain.js`. Chart solids in Analytics derive from tone (`good` → `var(--sg)`).
4. The `lib/db/*.js` `[value, label]` tuples become `LIST.map(v => [v, META[v].label])`.
5. Add the `sum_of_years_digits` label to the asset depreciation picker from `ASSET_DEPRECIATION_METHODS`.
6. `domain.test.js`: every value in each `@assetcore/domain` list the app shows has a meta entry.

**Siblings**: `Admin.jsx:607` `ROLES_LIST` and `:684` `initials`. Move the role descriptions into `packages/rbac` as `ROLE_DESCRIPTIONS` and import `initialsOf` from AuthContext (re-export it if TASK-1.1 unexported it).

**Must not break**: every badge still shows; colours change only where Q7 says (low priority is grey everywhere).

**Verify**: lint, build and app tests pass. Mutation check: delete one meta entry and see `domain.test.js` go red. Manually open Work Orders, Assets (detail panel, Maintenance tab), Analytics and Scan: low priority is grey in all of them, and "In Progress" casing matches everywhere. Take screenshots light and dark.

---

## Wave 4: App foundations

### TASK-4.1: One `useCan()` hook so per-user grants count everywhere
- **Severity**: MEDIUM
- **Category**: frontend
- **Effort**: S
- **Depends on**: TASK-0.2
- **Finding**: RF-FE-01, OOS-07
- **Files**: `apps/app/src/lib/AuthContext.jsx`, every file with `can(` (62 call sites in 18 files at baseline; list with `grep -rln "\bcan(" apps/app/src`), `apps/app/eslint.config.js`

**Problem**: 13 calls pass no `extraCaps`, so a per-user grant (Admin > Access) is ignored there: `Risks.jsx:342-343`, `Defects.jsx:308-312`, `Approvals.jsx:422-423`, `Depreciation.jsx:354`, `SpareParts.jsx:239-241`. 11 of these check grantable caps (`GRANTABLE_CAPS`, `packages/rbac/index.js:146`), so the gap is live.

**Fix**:
1. In `AuthContext.jsx`, add `export function useCan() { const { roleKey, extraCaps } = useAuth(); return useCallback((cap) => can(roleKey, cap, extraCaps), [roleKey, extraCaps]) }`.
2. Replace every `can(roleKey, X, extraCaps)` and `can(roleKey, X)` in components and pages with `const can = useCan()` then `can(X)`. `App.jsx` and `Sidebar.jsx` switch too.
3. Add an ESLint `no-restricted-imports` rule: importing `can` from `lib/rbac` is an error outside `lib/AuthContext.jsx`.

**Siblings**: `ADMIN_ENTRY_CAPS` checks in `App.jsx`, `Sidebar.jsx` and `Admin.jsx` use `can` in loops; they move to the hook too.

**Must not break**: what each role sees without grants.

**Verify**: lint and build pass. `grep -rn "can(roleKey" apps/app/src` returns 0. Manual: as the owner, invite a test user with role `viewer` and grant `risk:create` and `defect:create` (Admin > Users > Access). Sign in as that user: Risks shows New Risk and Defects shows New Defect. At baseline neither showed.

### TASK-4.2: Show every failed save; one error-text path
- **Severity**: MEDIUM
- **Category**: frontend
- **Effort**: S
- **Depends on**: TASK-0.5
- **Finding**: RF-FE-10, RF-FE-11, OOS-09
- **Files**: `apps/app/src/lib/errors.js`, `apps/app/src/pages/{Integrations,Notifications,Assets,Settings,Approvals,WorkOrders,Risks,Defects,Depreciation,Admin}.jsx`, `apps/app/src/components/{CompliancePanel,InspectionsPanel}.jsx`, `apps/app/src/lib/db/approvals.js`, `apps/app/src/lib/NotificationsContext.jsx`, `apps/app/src/lib/__tests__/errors.test.js`

**Problem**: Four save paths swallow errors.
- `Integrations.jsx:116` `save()`: `catch { /* non-fatal */ }`.
- `Notifications.jsx:123` `togglePref`: optimistic toggle with no rollback.
- `Assets.jsx:397-398`: photo and document uploads after create are swallowed, but the toast still says "Asset created.".
- `Settings.jsx:42-44`: `api.get('/profile').catch(() => {})` leaves a blank form, and Save then writes `full_name: ''`.

Separately, 17 places compare `e.message === 'code'` and retype a sentence. Five of those sentences are word for word the entry in `ERROR_MESSAGES`. `lib/db/approvals.js:68` keeps a second table, `DIRECT_ERROR_TEXT`.

**Fix**:
1. `errors.js`: `errorText(err, fallback, overrides = {})` checks `overrides[err.code]` first and compares on `err.code`, not `err.message`.
2. Integrations save: on failure, `toast.error(errorText(e, 'Could not save the integration settings.'))`.
3. Notifications toggle: on failure, restore the previous value and show `toast.error(...)`. Do the same for `markRead`/`markUnread`/`markAllRead` in `NotificationsContext.jsx:45,53,61` (toast only, state already honest).
4. Asset create: count failed uploads. If any failed, the toast says `Asset created. N file(s) could not be attached; open the asset to try again.`
5. Settings: if the profile load fails, show the error, disable Save until a load succeeds, and never send an empty `full_name` (validate before submit).
6. Replace the 5 identical ternaries (`Approvals.jsx:227`, `SpareParts.jsx:94,170`, `WorkOrders.jsx:521`, `CompliancePanel.jsx:453`) with plain `errorText(e, fallback)`. Move the context-specific ones (list in 05c RF-FE-11) to the `overrides` argument. Fold `DIRECT_ERROR_TEXT` into `ERROR_MESSAGES` or overrides.
7. Extend `errors.test.js` for overrides.

**Siblings**: run `grep -rnE "catch *(\(\w*\))? *\{ *(/\*.*\*/)? *\}" apps/app/src` for every empty catch. Each one on a user action gets a toast. Each one on a decorative load stays, with a comment saying why.

**Must not break**: success paths unchanged.

**Verify**: lint, build and tests pass. Manual: stop the API, click Save on Integrations, and see an error toast. Toggle a notification preference with the API stopped: it flips back and shows an error. Restart the API.

### TASK-4.3: One date module and money through `useMoney`
- **Severity**: MEDIUM
- **Category**: frontend
- **Effort**: S
- **Depends on**: TASK-0.5
- **Finding**: RF-FE-18, RF-FE-19, RF-FE-20, OOS-11, OOS-12
- **Files**: `apps/app/src/lib/dates.js` (new), `apps/app/src/lib/__tests__/dates.test.js` (new), `apps/app/src/components/{InspectionsPanel,CompliancePanel,SendForApproval,TransferAssetsModal}.jsx`, `apps/app/src/pages/{Dashboard,Maintenance,Calendar,Defects,Risks,Integrity,Assets,Settings,Approvals,WorkOrders,Depreciation,SpareParts}.jsx`

**Problem**:
- `new Date().toISOString().slice(0,10)` is the UTC date. It is used for "today" in 7 places (`InspectionsPanel.jsx:63`, `CompliancePanel.jsx:396`, `Dashboard.jsx:138`, `Maintenance.jsx:35-36,161-162,345`, `Calendar.jsx:28`, `Defects.jsx:56`, which is also frozen at module load). For an hour after Lagos midnight it is yesterday.
- Two places do it right (`Assets.jsx:693` `localDateStr`, `TransferAssetsModal.jsx:13` `todayLocal`).
- `fmtDate` is copied 7 times.
- `WorkOrders.jsx:38-43` `fmtNaira` and `Depreciation.jsx:19-22` `exact()` print ₦ whatever the org's currency, and eight labels hardcode "(₦)".

**Fix**:
1. `lib/dates.js` (local time, `en-GB`): `todayISO()`, `addDaysISO(iso, n)`, `fmtDate(d)` (the common format `{ day:'numeric', month:'short', year:'2-digit' }`), `fmtDateLong(d)` (`year:'numeric'`, the Settings one), `fmtDateTime(ts)`, `fmtWhen(ts, empty = '\u2014')`.
2. Replace every local `fmtDate`, `fmtWhen`, `fmtDateTime`, `localDateStr`, `todayLocal`, `isoToday` and every `toISOString().slice(0, 10)` used as "today". `Defects.jsx:56` computes the default when the modal opens, not at module load. Migrate `Calendar.jsx` last: its month grid parses `T00:00:00Z` on purpose. Keep that parsing and check the first and last day of a month render in the right cells.
3. `WorkOrders.jsx`: delete `fmtNaira` and use `money()` from `useMoney()` (already called at `:399`, `:497`). `Depreciation.jsx`: replace `exact()` with `moneyFull()`.
4. Labels: replace "(₦)" at `WorkOrders.jsx:156,284`, `Assets.jsx:505,531`, `SpareParts.jsx:122,204`, `Depreciation.jsx:136` and the `Approvals.jsx:246` placeholder with the base currency symbol from `useMoney()` (read `money.jsx` for the symbol helper; add `symbol` to its return if missing).
5. `dates.test.js`: `todayISO()` with a faked clock at 2026-10-05T23:30:00Z under `TZ=Africa/Lagos` returns `2026-10-06`. Set `process.env.TZ` in the vitest config or the test.

**Siblings**: `grep -rn "toISOString().slice(0, *10)" apps/app/src`. Each remaining hit must be formatting a stored timestamp, not "today"; list them in the commit.

**Must not break**: date display formats (same strings as before); NGN orgs see the same money.

**Verify**: lint, build and tests pass. Mutation check: make `todayISO` use `toISOString` and see the test go red. Manual: in the backoffice, set the instance base currency to USD (or in SQL: `update organizations set settings = jsonb_set(...)`; read `money.jsx` for where the currency is read), then open a work order with a cost: it shows $, not ₦. Set it back.

### TASK-4.4: Stable context values and an error path for sign-in loading
- **Severity**: MEDIUM
- **Category**: frontend
- **Effort**: S
- **Depends on**: TASK-4.1
- **Finding**: RF-FE-04, RF-FE-05, OOS-10, B11
- **Files**: `apps/app/src/lib/{AuthContext,ToastContext,NotificationsContext,LocationFilterContext,SidebarContext}.jsx`, `apps/app/src/lib/auth.js`

**Problem**: Each provider builds a new `value={{...}}` on every render, so all consumers re-render. `ToastContext.jsx:34` re-renders 28 consumers on every toast. `AuthContext.jsx:73` `extraCaps ?? []` makes a new array each render, which defeats `useCan`'s `useCallback`. `getSession().then(...)` (`AuthContext.jsx:26`) has no catch: if the server is unreachable and the stored token has expired, `loading` stays true forever (splash screen). `/org` + `/sites` (`:54-60`) has no catch either.

**Fix**:
1. Wrap each provider's value in `useMemo` with its real dependencies. Use a module-level `const EMPTY = []` for `extraCaps`.
2. Split `ToastContext` so the `toast` API object is provided by a stable context and the list state stays inside the provider.
3. `getSession()` path: add `.catch(() => { setSession(null) }).finally(() => setLoading(false))` so an unreachable server lands on the sign-in page (the `OfflineBanner` already shows when offline). Read `lib/auth.js:48-51` first and keep any token-clearing it does.
4. `/org` + `/sites`: on failure, keep `org` null and show `toast.error('Could not load your organisation. Some figures may use default settings.')` once.

**Siblings**: none.

**Must not break**: sign-in, sign-out, token refresh, the location filter, notification polling.

**Verify**: lint and build pass. Manual: sign in, stop the API, put an expired token in storage (or wait out `JWT_ACCESS_TTL` in a dev env set to 1m), and reload: the app shows the sign-in page within a few seconds, not an endless splash. In React DevTools Profiler, trigger a toast: pages using `useToast` no longer re-render.

### TASK-4.5: `useResource` hook for loading, errors and stale responses
- **Severity**: MEDIUM
- **Category**: frontend
- **Effort**: M
- **Depends on**: TASK-4.2
- **Finding**: RF-FE-13, B9
- **Files**: `apps/app/src/lib/useResource.js` (new), `apps/app/src/lib/__tests__/useResource.test.jsx` (new), `apps/app/src/pages/{Integrity,Depreciation}.jsx`

**Problem**: Every page hand-writes loading, error and data state: 28 `loading` flags, 68 error states, 26 `useEffect(() => { load() }, [load])`. Only 12 of 84 effects ignore a response that arrives after a newer one, so switching the location filter quickly can show stale data (`Integrity.jsx:62-65` has no guard).

**Fix**:
1. `useResource(fetcher, deps, { initial = null, errorFallback, overrides } = {})` returns `{ data, loading, error, reload, setData }`. It tracks a request id in a ref and ignores responses older than the latest. `error` is already `errorText(e, errorFallback, overrides)`. `loading` starts `true`.
2. Pilot on `Integrity.jsx` (the location-dependent overview) and `Depreciation.jsx:356-381` (three parallel loads plus the `listAssets` side lookup).
3. Tests with `@testing-library/react` (add as devDependency; set vitest `environment: 'jsdom'` for `*.test.jsx`): stale response ignored, error text set, reload refetches.

**Siblings**: the remaining pages adopt it during their Wave 5 split or when next touched. Add a section 0 rule note in the commit: "new data loading uses useResource".

**Must not break**: Integrity and Depreciation show the same data and states as before.

**Verify**: tests pass. Mutation check: remove the request-id check and see the stale-response test go red. Manual: on Integrity, switch the location filter twice quickly: the final view matches the last selected location.

### TASK-4.6: One `<Modal>`, an in-app confirm, and toasts instead of alerts
- **Severity**: MEDIUM
- **Category**: frontend
- **Effort**: M
- **Depends on**: TASK-4.4
- **Finding**: RF-FE-14, RF-FE-12, B14 (decision Q6(e))
- **Files**: `apps/app/src/components/Modal.jsx` (new), `apps/app/src/components/ConfirmDialog.jsx` (new), `apps/app/src/lib/ConfirmContext.jsx` (new), `apps/app/src/main.jsx` or `App.jsx` (provider), `packages/ui/index.css`, `apps/app/src/pages/{Defects,Risks}.jsx`, every file with `alert(`

**Problem**: 33 modals each paint their own backdrop, z-index (200, 1000, 1100), width, radius and footer. None closes on Escape. Eight have fixed widths with no `maxWidth` (`Risks.jsx:226`, `Depreciation.jsx:90`, `Approvals.jsx:235`, `SpareParts.jsx:109,178`, `Defects.jsx:107,200`, `AssetQr.jsx:49`). The mobile commit's `.modal-overlay` / `.modal-card` classes (`packages/ui/index.css:453-469`) are used nowhere. There are 16 `alert()` calls (13 show errors) and 14 `confirm()` calls.

**Fix**:
1. CSS tokens in `index.css`: `--z-panel: 200`, `--z-modal: 1000`, `--z-toast: 2000`, `--backdrop: rgba(0,0,0,.4)`. `.modal-overlay` uses `--z-modal` and `--backdrop`.
2. `Modal({ title, width = 460, onClose, footer, as = 'div', onSubmit, children })` renders `.modal-overlay` > `.modal-card` with `--modal-w: width`. It closes on Escape and on a backdrop click, moves focus into the card on open, and restores focus on close.
3. `ConfirmContext` + `useConfirm()` returns `confirm(message, { danger, confirmLabel }) => Promise<boolean>`, rendered with `Modal`.
4. Replace every `alert(errorText(e...))` with `toast.error(...)`. Replace the success alert at `Depreciation.jsx:402` with `toast.success`. Replace every `confirm(...)` with `await confirm(...)`.
5. Pilot `Modal` on all modals in `Defects.jsx` and `Risks.jsx` (this fixes three of the fixed-width ones). The remaining modals move during the Wave 5 splits.
6. Raise the ESLint `alert` rule from warn to error.

**Siblings**: `ImageLightbox`, `Sidebar` and `Topbar` have their own Escape handling. Leave them.

**Must not break**: every destructive action still asks before acting; Defects and Risks create, edit and raise flows.

**Verify**: lint (0 `alert` hits) and build pass. Manual: on Defects, open New Defect, press Escape: it closes. Open it at 375px width: the card fits with side margins. Archive a defect: the in-app confirm appears, and Cancel does nothing. Screenshots light and dark.

### TASK-4.7: Shared `Stat`, `EmptyState`, `TableState`, `Field`
- **Severity**: LOW
- **Category**: frontend
- **Effort**: S
- **Depends on**: TASK-4.6
- **Finding**: RF-FE-16, RF-FE-17 (decision Q7)
- **Files**: `apps/app/src/components/{Stat,EmptyState,TableState}.jsx`, `apps/app/src/components/form.jsx` (new), `apps/app/src/pages/{Approvals,Defects,Risks,Depreciation,Devices,Maintenance}.jsx`, `apps/app/src/components/CompliancePanel.jsx`, `packages/ui/index.css`

**Problem**: `Stat` has 5 copies (4 identical: `Approvals.jsx:27`, `Defects.jsx:42`, `Risks.jsx:330`, `SpareParts.jsx:38`; `Depreciation.jsx:24` adds `hint`). `EmptyState` has 2 copies plus `EmptyPM`, `EmptyChart`, and 42 inline "Loading…" / "No …" cells. Labels come in four styles. 28 hand-rolled input style objects bypass `.input`, so those inputs lose the focus ring.

**Fix**:
1. `Stat({ label, value, hint })` (the Depreciation version), `EmptyState({ title, body, action })`, `TableState({ loading, error, empty, colSpan, emptyText })`.
2. `form.jsx`: `Field({ label, required, hint, children })` using `.label` (weight 500, Q7), `FormError`, `useForm(initial)` returning `{ form, set, setForm }`. Add `.input-sm` (34px, 13px) to `index.css`.
3. Replace the `Stat` and `EmptyState` copies in the listed files. Leave `SpareParts.jsx` alone (parked, Q1). Adopt `Field` and `TableState` in `Defects.jsx` and `Risks.jsx`; other files adopt them in Wave 5.

**Siblings**: `Field` copies at `Assets.jsx:210`, `Scan.jsx:25`, `TransferAssetsModal.jsx:17` (migrate during 5.10; migrate Scan and TransferAssetsModal here).

**Must not break**: stat strips and empty states look the same apart from Q7 label weight.

**Verify**: lint, build pass. Screenshot Approvals, Defects, Risks and Depreciation before and after at desktop and 375px: only the intended differences.

### TASK-4.8: Profile, password and file helpers in `lib`, one query-string builder
- **Severity**: LOW
- **Category**: frontend
- **Effort**: S
- **Depends on**: TASK-4.2
- **Finding**: RF-FE-08, RF-FE-09
- **Files**: `apps/app/src/lib/db/profile.js` (new), `apps/app/src/lib/db/files.js` (new), `apps/app/src/lib/auth.js`, `apps/app/src/lib/apiClient.js`, `apps/app/src/lib/db/{analytics,devices,escalations,notifications,pmSchedules,risks,dashboard,integrity,complianceLicences}.js`, `apps/app/src/pages/{Settings,ForcePasswordChange,ForgotPassword,ResetPassword}.jsx`, `apps/app/src/lib/AuthContext.jsx`, `apps/app/src/components/{AuthImage,ImageLightbox,InspectionsPanel,CompliancePanel}.jsx`

**Problem**: 12 files call `api.*` directly despite the `lib/db` convention (`lib/db/assets.js:3-5`). Change-password is written twice (`Settings.jsx:62`, `ForcePasswordChange.jsx:30`). File paths `/files/${rel}` are built by hand in 9 places. Query strings are built three ways, and some skip encoding (`analytics.js:34` dates, `devices.js:4` statuses).

**Fix**:
1. `profile.js`: `getProfile`, `updateProfile`. `auth.js`: `changePassword`, `forgotPassword`, `resetPassword`. `AuthContext.jsx` uses `getOrg`/`listSites` if they exist in `lib/db` (they do at baseline per 05c).
2. `files.js`: `fileUrl(rel)`, `fileBlobUrl(rel)`, `downloadFile(rel, name)`.
3. `apiClient.js`: export `qs(obj)` that drops `undefined`, `null`, `''` and `'all'` and encodes the rest. Every `lib/db` module builds its query with `qs`.

**Siblings**: `grep -rn "api\.\(get\|post\|patch\|put\|del\)(" apps/app/src/pages apps/app/src/components` returns only file-serving calls that moved to `files.js`, i.e. 0 after this task.

**Must not break**: sign-in, forgot/reset/force password, profile save, every image and document view, every filtered list.

**Verify**: lint, build, tests pass. Manual: change your password in Settings and sign in with the new one; open an asset photo and a licence document; filter Analytics by a date range.

---

## Wave 5: Big splits (one per session)

Rule for every task in this wave: **move first, then improve.** Make one commit that only moves code (no edits, imports adjusted) and passes lint, build and tests. Then make separate commits that adopt the Wave 2 helpers (`parseOr400`, `send`, `listQuery`) or the Wave 4 primitives (`useResource`, `Modal`, `Field`, `TableState`, `lib/domain`, `lib/dates`) in the moved files.

### TASK-5.0: Route smoke test for each role
- **Severity**: MEDIUM
- **Category**: frontend
- **Effort**: M
- **Depends on**: Wave 4
- **Finding**: RF-FE-31 (step 2)
- **Files**: `scripts/seed-dev.mjs`, `e2e/smoke.spec.js` (new, repo root), `playwright.config.js` (new), `package.json` (root), `.github/workflows/check.yml`

**Problem**: The file splits move thousands of lines of JSX with no test that pages still render. The dev seed creates only an owner (`seed-dev.mjs:70`).

**Fix**:
1. Seed one active user per tenant role in `ROLE_KEYS` (password `Password123!`, emails `<role>@ngml.example`). Print them at the end.
2. Add `@playwright/test` (root devDependency). The config starts `npm run dev:api` and `npm run dev` as `webServer` entries.
3. `smoke.spec.js`: for each role, sign in, visit every route in `App.jsx` that the role can reach (read the gates), and assert no `ErrorBoundary` text and no `console.error`. On Assets, Work Orders and Defects, open the first row's detail and the main "New" modal, then close it.
4. Add `npm run e2e`. Add it to CI only if it runs in under 5 minutes against the CI Postgres service (seed first).

**Siblings**: none.

**Must not break**: the seed stays idempotent.

**Verify**: `npm run e2e` passes locally. Mutation check: throw inside `Admin.jsx`'s render and see the owner case go red.

### TASK-5.1: One way to close a work order
- **Severity**: MEDIUM
- **Category**: backend
- **Effort**: L
- **Depends on**: TASK-2.4, TASK-2.5, TASK-2.8
- **Finding**: RF-API-20, RF-API-23, OOS-05 (decision Q6(a))
- **Files**: `apps/api/src/services/workOrders.ts` (new), `apps/api/src/services/stock.ts` (new), `apps/api/src/routes/workOrders.ts`, `apps/api/src/routes/maintenanceEvents.ts`, `apps/api/src/routes/spareParts.ts`, `apps/api/test/workOrderClose.test.ts` (new)

**Problem**: Only `POST /work-orders/:id/transition` (`workOrders.ts:482-583`) applies the transition rules, consumes parts (`consumeParts` `:434-480`), resolves the source defect (`:529-540`), stamps `actual_end`, notifies and refreshes health. `PATCH /work-orders/:id` accepts `status` (`ALLOWED` `:25`, `woInput` `:112`) and skips all of that except the asset status sync. `POST /work-orders` accepts any status, including `closed` (`:355`). Closing through a maintenance completion (`maintenanceEvents.ts:111-127`) skips parts and defects. The stock ledger write is duplicated in `spareParts.ts:215-245` and `:143`.

**Fix**:
1. `services/stock.ts`: `moveStock(c, { partId, qty, kind, reason, workOrderId? })` locks the part row, computes `balance_after`, updates `quantity_in_stock` and inserts `stock_movements`. Use it in `consumeParts` and in `spareParts.ts` adjust and opening balance.
2. `services/workOrders.ts`: move `generateWoRef` (or import `nextWoRef` from `refs.ts`), `recordAssignment`, `syncAssetStatusForWorkOrder`, `consumeParts` and `createForApproval` from the router. Add `transitionWorkOrder(c, woId, to, { actorId, comment, report })` returning `{ data } | { error: 'not_found' | 'invalid_transition' | 'insufficient_stock' | ... }` with every side effect `/transition` has today.
3. `/transition` calls it. `PATCH /work-orders/:id`: remove `status` from `ALLOWED` and `woInput`; a body with `status` answers 400 `use_transition`. `POST /work-orders`: allow only `open` and `draft` (check which initial statuses `lib/db/workOrders.js` and `createForApproval` send; allow exactly those). `maintenanceEvents.ts`: when the completion closes a linked WO, call `transitionWorkOrder(c, id, 'closed', ...)` and keep its asset-level health refresh.
4. Before changing PATCH, run `grep -rn "status" apps/app/src/lib/db/workOrders.js apps/app/src/pages/WorkOrders.jsx` and confirm the app never PATCHes `status` (05d says it uses `/transition`). If the app does PATCH status anywhere, switch that caller to `transitionWorkOrder` in `lib/db` in the same commit.

**Siblings**: the board drag in `WorkOrders.jsx` (check that it calls `transitionWorkOrder` in `lib/db`).

**Must not break**: every WO status move in the UI, the board drag, approvals that create WOs (`createForApproval`), defect raise-to-WO, maintenance completion.

**Verify**: new `test/workOrderClose.test.ts`. Create a WO with a reserved part line and a source defect, and close it through each path: `/transition`, maintenance completion, and a PATCH with status (expect 400 `use_transition`). After each successful close, stock dropped by the line quantity, the defect is resolved, `actual_end` is set, and one closing notification exists. Existing tests pass. Mutation check: skip `consumeParts` in the service and see the stock assertions go red.

### TASK-5.2: Split `approvals.ts` into rules, reads, matrix and direct
- **Severity**: MEDIUM
- **Category**: backend
- **Effort**: M
- **Depends on**: TASK-2.3, TASK-2.9, TASK-2.11
- **Finding**: RF-API-21, RF-API-12
- **Files**: `apps/api/src/routes/approvals/{index,rules,read,matrix,direct}.ts` (new), `apps/api/src/routes/approvals.ts` (delete), `apps/api/src/services/approvals.ts` (new), `apps/api/src/approvalRouting.ts`, `apps/api/src/routes/index.ts`

**Problem**: 939 lines covering matrix CRUD, reads, matrix submit/approve/reject/recall, and the direct route. The `insert into approval_events` statement is repeated 5 times outside `recordDirectEvent`, "load row plus events" 4 times when `loadApproval` exists, and the matrix-approve branch for `route = 'direct'` (`:480-506`) duplicates the direct-route code.

**Fix**: Follow the line map in `05d-refactor-api.md` RF-API-21 (approvals). Move: `:54-190` to `rules.ts`; `:237-341` to `read.ts`; `:343-685` route parsing to `matrix.ts`, with the logic in `services/approvals.ts` (`submitApproval`, `approveStep`, `reject`, `recall`); `:687-939` to `direct.ts`, with `lockForAssignee`, `recordDirectEvent` and `sendDirect` moving to `approvalRouting.ts` (the latter replaced by `send` from `http/result.ts`). `index.ts` composes them into `approvalsRouter`. After the move commit: replace the 5 inline event inserts with `recordApprovalEvent`, the 4 reloads with `loadApproval`, and the 8 `safeParse` blocks with `parseOr400`.

**Siblings**: `escalations.ts` imports `ROLE_KEYS` re-exported from approvals (`approvals.ts:39`). Import it from `@assetcore/rbac` instead.

**Must not break**: every approval flow (`test/directApprovals.test.ts`, `test/uatRound3.test.ts`).

**Verify**: API tests and typecheck pass after each commit. `wc -l apps/api/src/routes/approvals/*.ts`: no file over 350 lines.

### TASK-5.3: Split `workOrders.ts` into core, tasks and parts
- **Severity**: MEDIUM
- **Category**: backend
- **Effort**: M
- **Depends on**: TASK-5.1
- **Finding**: RF-API-21
- **Files**: `apps/api/src/routes/workOrders/{index,core,tasks,parts,attachments}.ts` (new), `apps/api/src/routes/workOrders.ts` (delete), `apps/api/src/routes/index.ts`

**Problem**: 859 lines (less after 5.1). `GET /work-orders/:id` opens three separate transactions (`:135-188`) where one would do.

**Fix**: Move the list, detail, create and patch routes to `core.ts`; the transition route to `core.ts` (it calls the service); attachments and comments to `attachments.ts`; `:662-744` to `tasks.ts`; `:745-859` to `parts.ts`. After the move commit: make the detail route use one `withOrgContext`, adopt `parseOr400`/`send`, and use `listQuery` for the list.

**Siblings**: none.

**Must not break**: WO list, detail, board, tasks, parts.

**Verify**: API tests pass; `npm run e2e` passes (WO detail opens).

### TASK-5.4: Split `assets.ts`; move import and transfer to services
- **Severity**: MEDIUM
- **Category**: backend
- **Effort**: M
- **Depends on**: TASK-2.5, TASK-2.11
- **Finding**: RF-API-21
- **Files**: `apps/api/src/routes/assets/{index,core,media}.ts` (new), `apps/api/src/routes/assets.ts` (delete), `apps/api/src/services/{assets,assetImport,assetTransfer}.ts` (new), `apps/api/src/routes/index.ts`

**Problem**: 775 lines: CRUD, a 120-line CSV import (`:351-469`), a 120-line transfer (`:524-644`), photos and documents.

**Fix**: Move `recomputeDerived` and `maintenanceDatesOrdered` to `services/assets.ts`; the import body to `services/assetImport.ts`; the transfer body to `services/assetTransfer.ts`; photo and document routes to `media.ts`; everything else to `core.ts`. After the move commit: adopt the http helpers.

**Siblings**: none.

**Must not break**: CSV import (`POST /assets/import`), transfer (`test/siteShutdownAndTransfer.test.ts`), photo and document upload.

**Verify**: API tests pass; `npm run e2e` passes.

### TASK-5.5: Split `compliance.ts`; share defect creation
- **Severity**: MEDIUM
- **Category**: backend
- **Effort**: M
- **Depends on**: TASK-2.8, TASK-2.11
- **Finding**: RF-API-21
- **Files**: `apps/api/src/routes/compliance/{index,licences,audits,findings}.ts` (new), `apps/api/src/routes/compliance.ts` (delete), `apps/api/src/services/defects.ts` (new), `apps/api/src/routes/defects.ts`, `apps/api/src/routes/index.ts`

**Problem**: 628 lines covering licences, audits and findings. The licence delete sits away from the rest of licence CRUD (`:218-231`). Raising a defect from a finding (`:569-628`) hand-copies defect creation from `defects.ts:144-170`.

**Fix**: Move licences (`:13-175`, `:218-275`), audits (`:276-509`, plus the audit document upload `:176-206`) and findings (`:510-628`) into the three files. `services/defects.ts` `createDefect(c, input, actor)` is used by `POST /defects` and by the finding-to-defect route.

**Siblings**: none.

**Must not break**: Compliance page: licences, audits, findings, raise defect.

**Verify**: API tests pass; add one test that raising a defect from a finding produces the same columns as `POST /defects` with the same input.

### TASK-5.6: One file per export dataset
- **Severity**: LOW
- **Category**: backend
- **Effort**: M
- **Depends on**: TASK-2.11
- **Finding**: RF-API-21
- **Files**: `apps/api/src/exports/{index,where}.ts`, `apps/api/src/exports/datasets/*.ts` (new, 11 files), `apps/api/src/routes/exports.ts`

**Problem**: 667 lines, 460 of them an 11-dataset registry. `schemaFlags` (`:561-569`) probes `information_schema` at runtime for columns every current instance has.

**Fix**: Move each `DATASETS` entry to `datasets/<name>.ts`, with the registry in `exports/index.ts` and the `Where` builder in `http/query.ts` (from TASK-2.11; delete the copy here). The route file keeps the two routes. Keep `schemaFlags` as is (behaviour-preserving); note it in the commit as a later removal candidate.

**Siblings**: none.

**Must not break**: every dataset downloads with the same columns (`test/exports.test.ts`).

**Verify**: API tests pass; download every dataset once from the Export page.

### TASK-5.7: One fetch core in `apiClient.js`
- **Severity**: MEDIUM
- **Category**: frontend
- **Effort**: M
- **Depends on**: TASK-5.0, TASK-4.8
- **Finding**: RF-FE-07
- **Files**: `apps/app/src/lib/apiClient.js`, `apps/app/src/lib/db/exports.js`

**Problem**: Five fetch wrappers disagree. `request` (`:58`) refreshes on 401 and carries `err.code`. `upload` (`:95`) refreshes but drops `shortfalls`. `download` (`:124`) and `blobUrl` (`:144`) never refresh and drop the code. `downloadExport` (`lib/db/exports.js:17`) has its own copy of the refresh and code handling, its own `BASE`, and a delayed object-URL revoke that `download` lacks (it revokes in the same tick, which can cancel the save in Firefox and Safari).

**Fix**: One private `send(method, path, { body, formData, as = 'json' | 'blob' })` that sets the auth header, refreshes and retries once on 401 (never for `/auth/refresh`), and builds errors with `code` and `shortfalls`. `request`, `upload`, `download` and `blobUrl` call it. `download` adopts the content-disposition filename and the delayed revoke. `downloadExport` becomes `api.download(url, fallbackName)`. Delete the second `BASE`.

**Siblings**: none.

**Must not break**: sign-in, a page load with an expired access token, photo upload, document view, export download.

**Verify**: `npm run e2e` passes. Manual: set `JWT_ACCESS_TTL=1m` in the dev API, sign in, wait 2 minutes, then open an asset photo and download an export; both work without signing in again.

### TASK-5.8: Split `Admin.jsx` by tab
- **Severity**: MEDIUM
- **Category**: frontend
- **Effort**: M
- **Depends on**: TASK-5.0
- **Finding**: RF-FE-26
- **Files**: `apps/app/src/pages/admin/*.jsx` (new), `apps/app/src/pages/Admin.jsx` (becomes a re-export)

**Problem**: 1,689 lines and 7 independent tabs.

**Fix**: Follow the line map in 05c RF-FE-26. Create `admin/AdminPage.jsx` (TABS + shell); one file per tab (`SitesTab`, `LocationsTab`, `CategoriesTab`, `UsersTab` with its modals and `PermissionsMatrix`, `AuditTab`, `ConfigTab`, `EscalationsTab`); and `admin/accessFields.jsx` (`Chip`, `BulkToggle`, `ScopeCapsFields`, `CAP_LABELS`). `Admin.jsx` becomes `export { default } from './admin/AdminPage.jsx'`. Lazy-load each tab with `React.lazy`. After the move commit: adopt `Modal`, `useConfirm`, `Field`, `TableState` and `useResource` tab by tab.

**Siblings**: none.

**Must not break**: every Admin tab and action.

**Verify**: lint, build and `npm run e2e` pass after each commit. Manual: each tab loads; invite a user; change a site; view the audit log with a filter.

### TASK-5.9: Split `WorkOrders.jsx`
- **Severity**: MEDIUM
- **Category**: frontend
- **Effort**: M
- **Depends on**: TASK-5.0
- **Finding**: RF-FE-27
- **Files**: `apps/app/src/pages/work-orders/*.jsx` (new), `apps/app/src/pages/WorkOrders.jsx` (becomes a re-export)

**Problem**: 1,110 lines: two modals that share most fields, a 520-line detail and a list plus board.

**Fix**: Follow 05c RF-FE-27. Create `WorkOrdersPage.jsx` (list + board; board drag in `WorkOrderBoard.jsx`), `WorkOrderForm.jsx` (one form used by New and Edit), and `WorkOrderDetail.jsx` (+ `Checklist`, `PartsSection`, `SpendApproval`). After the move commit: adopt the Wave 4 primitives, and split the side lookups from the filtered list so a filter click stops refetching sites, assets and users (`:874-885`).

**Siblings**: `Assets.jsx` `RaiseWOModal` creates a WO too. Make it use `WorkOrderForm` with a locked asset in TASK-5.10.

**Must not break**: list, board drag, deep link to a WO, New/Edit, tasks, parts, spend approval.

**Verify**: lint, build, `npm run e2e` pass. Manual: drag a card across board columns; open a WO from a notification link.

### TASK-5.10: Split `Assets.jsx`
- **Severity**: MEDIUM
- **Category**: frontend
- **Effort**: L
- **Depends on**: TASK-5.9
- **Finding**: RF-FE-25
- **Files**: `apps/app/src/pages/assets/*.jsx` (new), `apps/app/src/lib/csv.js` (new), `apps/app/src/lib/__tests__/csv.test.js` (new), `apps/app/src/pages/Assets.jsx` (becomes a re-export)

**Problem**: 1,720 lines and 29 commits, the most-edited file in the app.

**Fix**: Follow 05c RF-FE-25: `AssetsPage.jsx`, `AssetModal.jsx` (`:275-614`), `AssetDetailPanel.jsx` (`:898-1329`, + `ConditionPanel`, `HealthBar`), `assetModals.jsx` (`CompleteMaintenanceModal`, `PMTaskCompleteModal`), `ImportModal.jsx`, and `lib/csv.js` (`:219-274`, with unit tests for `parseCSV`). `RaiseWOModal` is replaced by `WorkOrderForm` from TASK-5.9 with the asset locked. After the move commit: adopt the primitives.

**Siblings**: none.

**Must not break**: list, filters, mobile card list, add/edit with photos and documents, detail panel tabs, raise WO, complete maintenance, CSV import, transfer.

**Verify**: lint, build, tests and `npm run e2e` pass. Manual: import the template CSV; edit an asset and add a photo; complete maintenance from the panel. Screenshots at 375px and desktop, light and dark.

### TASK-5.11: Extract the Maintenance week strip and modals
- **Severity**: LOW
- **Category**: frontend
- **Effort**: S
- **Depends on**: TASK-5.0
- **Finding**: RF-FE-28
- **Files**: `apps/app/src/components/WeekStrip.jsx` (new), `apps/app/src/pages/maintenance/*.jsx` (new), `apps/app/src/pages/Maintenance.jsx`

**Problem**: 640 lines; the page body is where edits land, and helper modals sit after the default export.

**Fix**: Move `weekDays` and the week render block to `WeekStrip.jsx`, and the modals and tables after the default export (`:408-640`) to `pages/maintenance/`. Keep the page in place. Then adopt `useResource` with side lookups split from the filtered list (`:164-182`).

**Siblings**: none.

**Must not break**: week view, schedule create/delete, task completion, generate tasks.

**Verify**: lint, build, `npm run e2e` pass.

---

## Wave 6: Tidy

### TASK-6.1: Shared test helpers; name test files by feature
- **Severity**: LOW
- **Category**: cleanup
- **Effort**: S
- **Depends on**: TASK-0.3
- **Finding**: RF-API-27, RF-API-28
- **Files**: `apps/api/test/helpers.ts`, `apps/api/test/factories.ts` (new), `apps/api/test/setup.ts` (new), `apps/api/vitest.config.ts`, `apps/api/test/*.test.ts`

**Problem**: `withClient` is defined 4 times and unique-suffix generators 4 times. There are 5 different asset/site factories, `seedFixtures()` runs in every file's `beforeAll`, and `uatRound2.test.ts`/`uatRound3.test.ts` are named for when bugs were found, not what they test.

**Fix**: Move `withClient`, `uniqueSuffix`, `makeSite`, `makeAsset`, `makeWorkOrder` and `type Api` into `helpers.ts`/`factories.ts`. Add `setupFiles: ['./test/setup.ts']`, which seeds. Move each `describe` from the round files into feature files (`reports` is gone; `analytics.test.ts`, `assets.test.ts`, `approvals.test.ts`, `depreciation.test.ts`, `rbac.test.ts`), keeping the round/task id in the test name. Remove any `// @ts-nocheck` added in TASK-0.3.

**Siblings**: none.

**Must not break**: test count. Record it before (`npx vitest run --reporter=verbose | grep -c "✓"`) and after; it must be equal.

**Verify**: API tests and typecheck pass with the same count.

### TASK-6.2: Test that TS and SQL depreciation agree
- **Severity**: LOW
- **Category**: backend
- **Effort**: S
- **Depends on**: none
- **Finding**: RF-API-30
- **Files**: `apps/api/test/depreciationParity.test.ts` (new)

**Problem**: Book value is computed twice: by `depreciation.ts` `buildSchedule` (schedules) and by SQL `recompute_asset_depreciation_for()` (the nightly register). Nothing checks that they agree.

**Fix**: For each method both support (straight line, declining balance, sum of years digits), create an asset with fixed cost, salvage, life and in-service date. Run the SQL recompute and `buildSchedule` with the same inputs, and assert the SQL `nbv_cents` equals the schedule's closing value for the current period (within 1 cent).

**Siblings**: none.

**Must not break**: nothing (test only).

**Verify**: the test passes, or fails and shows a real drift. If it fails, do not "fix" either engine in this task: record the numbers in OUT-OF-SCOPE.md and mark the test `.skip` with a comment naming the entry.

### TASK-6.3: Page shell, theme context and one route table
- **Severity**: LOW
- **Category**: frontend
- **Effort**: M
- **Depends on**: TASK-4.1, TASK-5.0
- **Finding**: RF-FE-02, RF-FE-03, RF-FE-15
- **Files**: `apps/app/src/lib/ThemeContext.jsx` (new), `apps/app/src/components/PageShell.jsx` (new), `apps/app/src/routes.js` (new), `apps/app/src/App.jsx`, `apps/app/src/components/{Sidebar,Topbar}.jsx`, all 23 page files

**Problem**: `dark`/`toggleDark` are passed as props through 23 pages only to reach `Topbar`. Every page repeats the same shell (inline column style ×25). Route permissions are defined in `App.jsx:136-156` and again in `Sidebar.jsx:37-66`, and they already disagree for `/inspections`.

**Fix**: `ThemeContext` holds `preferredTheme`/`applyTheme` (`App.jsx:70-103`). `PageShell({ active, breadcrumb, children })` renders the shell and reads the theme. `routes.js` is one table `{ key, path, label, icon, cap?, anyCap?, soon?, section, element }`: `App.jsx` maps it to routes behind a `Gate`, and `Sidebar` filters it by `section`. Give `/inspections` the `inspection:read` gate on both, matching the sidebar today.

**Siblings**: none.

**Must not break**: each role's sidebar and reachable routes (the smoke test covers it); theme persistence across reload.

**Verify**: lint, build and `npm run e2e` pass. Toggle dark mode and reload: it persists.

### TASK-6.4: `auditFromReq` so every audit row carries actor, org and IP
- **Severity**: LOW
- **Category**: backend
- **Effort**: M
- **Depends on**: Wave 5 API splits
- **Finding**: RF-API-15
- **Files**: `apps/api/src/audit.ts`, the 21 route files that call `writeAuditLog`

**Problem**: 105 calls repeat `orgId: rows[0].org_id, actorId: req.claims!.sub`. Many queries add `returning ..., org_id` only to feed that call. Only 1 of 105 tenant calls passes `ip`.

**Fix**: Add `auditFromReq(c, req, { action, entityType, entityId, before?, after? })`, which fills `orgId` from the caller's org, `actorId` from the caller, and `ip` from `req.ip`. Migrate every call. Drop `org_id` from a `returning` clause only when nothing else reads it.

**Siblings**: platform calls (`writePlatformAuditLog`) stay.

**Must not break**: every audit row's action, entity and actor (`test/attributionAndAudit.test.ts`).

**Verify**: API tests pass; add one assertion that a tenant mutation's audit row has a non-null `ip`.

---

## 6. Quality self-check

- Every CRITICAL/HIGH/MEDIUM finding in the report maps to a task, except OOS-19, 20 and 22, which are logged out of scope.
- Every task names its decision when it changes behaviour (Q6 letters).
- The security-relevant tasks (2.2, 2.3, 2.4, 2.5, 2.8, 5.1) each have a negative test and a mutation check.
- Grep for hidden choices: TASK-1.6 branches on the owner's row count, which is an owner action, not a choice left to the executor. TASK-2.2 step 3 has an explicit rule for when to add a cap. No other task contains "either", "if feasible" or "consider".

## 7. UAT hand-off

After Wave 5, run `em-uat-plan-execute` against the dev stack, using the role users seeded in TASK-5.0. Focus on:
- integrations as a viewer (403);
- per-user grants on Risks and Defects;
- closing a work order three ways (stock and defect effects);
- concurrent defect creation;
- uploads with a renamed file;
- the Admin, Work Orders and Assets pages after their splits, at 375px and desktop, light and dark.
