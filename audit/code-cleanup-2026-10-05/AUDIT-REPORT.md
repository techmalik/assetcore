# AssetCore portal: dead code and refactoring audit

App: AssetCore tenant portal (`apps/app`) and the API behind it (`apps/api`), plus `packages/rbac` and `packages/ui`.
Baseline: `main @ 913e934`, 2026-10-05. Audit only; no source file was changed.

```
Question:    What dead code can be removed from the portal, and what should be refactored to make the code better?
Decision:    Which removals and refactors to approve for implementation.
Judged against: the app's purpose and its own conventions; no external spec.
Deliverable: this report + IMPLEMENTATION-PLAN.md + SESSION-PROMPTS.md.
Scope:       in: apps/app, the apps/api it calls, packages/rbac, packages/ui.
             out: apps/admin screens (backoffice), new features, UX redesign. Bugs seen on the way: OUT-OF-SCOPE.md.
Constraints: audit first; refactors behaviour-preserving unless a decision below says otherwise; work lands on main by fast-forward.
Done when:   every dead-code candidate is classed (delete / unexport / your call / keep) and every refactor is a plan task with a verify step.
```

## The answer

1. **Dead code: about 320 lines can go now with no decision from you** (about 155 in the app, 160 in the API). Another **about 2,000 lines** depend on four decisions, mostly about parked features (Spare Parts, the documents registry, the old Reports API). That is roughly 6% of the 33k lines in scope. Little of it is old junk: the codebase has no TODOs, no commented-out code and no leftover Supabase code. Most of it is helpers and endpoints left behind when screens changed.
2. **Refactoring: the code is sound underneath but hand-written everywhere above that.** The API has good foundations (one RLS transaction helper, one audit writer, zod on every body, pure maths for health and depreciation). The app has the start of shared pieces it doesn't use. The real problem is copies: the same job is written 2 to 30 times and the copies have started to differ. **That divergence is already causing bugs**: per-user grants ignored on four pages, three different ways to close a work order, a naira sign hardcoded on a configurable currency, and a security check present in the UI but missing from the API.
3. **Before refactoring anything, add a safety net.** Every push to `main` deploys to production with no build, typecheck or test step. The API has 236 integration tests (all pass at baseline), but nothing runs them. The 18.5k-line frontend has no tests and no linter. The linter costs almost nothing: a trial ESLint run found 0 errors.

Counts: 31 frontend and 21 API dead-code items, 32 frontend and 34 API refactor items, plus 22 bugs logged out of scope (1 HIGH). Most of those bugs are closed by the refactor tasks.

The three most important things:
- **Gate the deploy on tests and lint first** (TASK-0.1 to 0.3). Without that, every refactor below lands in production unchecked.
- **Make each API router check permissions once, and on every write** (TASK-2.1, 2.2). Today each of 28 routers re-runs the login and membership check for requests that aren't its own: a write to the last-mounted router runs the membership database query about 28 times. Separately, two write routes have no permission check at all: integrations (HIGH, OOS-01) and documents.
- **One shared copy of each value list, date helper, money formatter and permission hook** (Waves 3 and 4). That is where the copies have already caused bugs.

## Findings

Severity: MEDIUM = maintainability debt that is causing or will cause bugs; LOW = clean-up; IDEA = optional. Evidence level: `tool` (knip, tsc, ESLint dry run), `source-confirmed` (grep and read), `risk` (plausible, not confirmed). Full evidence is in the phase files: dead code in [05a](05a-dead-code-frontend.md) and [05b](05b-dead-code-api.md), refactors in [05c](05c-refactor-frontend.md) and [05d](05d-refactor-api.md).

### Safety net

| ID | Sev | Finding | Evidence | Level |
|---|---|---|---|---|
| RF-API-31 | MEDIUM | Every push to `main` deploys with no build, typecheck or test step. Test files are never typechecked. | `.github/workflows/deploy.yml`; `apps/api/tsconfig.json` excludes tests | source-confirmed |
| RF-FE-29 | MEDIUM | No linter in any workspace, and no frontend tests. In plain JS a missing import fails only at runtime, on that page. A trial ESLint run gives 0 errors and 9 unused-variable warnings. | `apps/app/package.json` scripts; dry run in 05c §H | tool |

### Dead code: remove now (no decision needed)

| ID | Sev | What | Lines |
|---|---|---|---|
| DC-FE-03 | LOW | `isConfigured` is hardcoded `true`, so the `NotConfigured` page and 6 branches can never run. The page also tells a client to "seed demo data". | ~36 |
| DC-FE-11..21 | LOW | 13 frontend API helpers nothing calls (e.g. `getAsset`, `getInspection`, `softDeleteWorkOrder`, `listWorkOrderTasks`, `softDeleteDevice`, which is imported but never called). Also `currentOrgId`, the `signInWithSSO` stub, `healthTextColor`, `CURRENCY_SYMBOL`, `viewDocument`, 4 unused imports, `PRIORITY_COLOR`, and the unused `prefill` prop on two modals. | ~80 |
| DC-FE-23 | LOW | Context fields no one reads (`session`, `refresh`, 4 fields of `useMoney()`). | ~4 |
| DC-FE-29 | LOW | Unused CSS `.btn-danger`, `.kpi`. (`.modal-overlay` / `.modal-card` are also unused but get adopted in TASK-4.6, not deleted.) | ~9 |
| DC-FE-06..17 | LOW | 14 symbols exported but only used in their own file: drop `export`. | 0 |
| DC-API-01 | LOW | `DELETE /compliance-audits/:id` is registered twice. The first, looser copy wins; the stricter one (refuses an already-archived audit) never runs. | 10 |
| DC-API-07 | LOW | 6 read endpoints with no caller: licence counts, audit stats, single inspection, single integration, WO tasks list, WO parts list. Their data already arrives embedded in other responses. | ~86 |
| DC-API-09/10/17/19 | LOW | `mailerConfigured`, an `orgId` branch no caller reaches, the "decay math" test of a retired SQL function, a defensive `ROLE_RANK` cast, Supabase-era comments, 35 export-only-for-itself symbols. | ~25 |
| DC-API-11 | LOW | SQL function `licence_status(date)` is never called (drop in a forward migration). | migration |
| DC-API-12 | LOW | The old linear-decay health SQL (`recompute_asset_health`, `_for`) is only used by the dev seed and that one test. Production uses the TypeScript engine. | migration |
| DC-API-20 | LOW | Empty, untracked `supabase/` folder on this machine. | local only |

Kept on purpose, with reasons in the phase files: `GET /api/health` and `/api/version` (ops scripts use them), `GET /assets/:id` (9 tests), `pino-pretty`/`pino-roll` (knip false positive, loaded by name), the `lib/rbac.js` re-export, `telemetry_readings` (IoT roadmap), the legacy asset statuses (live rows may carry them), `ComingSoon`.

### Dead code: your decision first

| ID | What | Lines if deleted |
|---|---|---|
| DC-FE-01 / DC-API-03 | **Spare Parts**: 509-line page, 11 API routes, 11 helpers. Parked in 913e934 as "Warehouse Inventory, coming soon". The work-order part picker still reads the catalogue, but no screen can add parts. | ~830 |
| DC-FE-02 / DC-API-04 | **Documents registry**: a panel and 4 `/documents` routes that were ported but never mounted. Files uploaded there can't be downloaded, because the file server has no rule for them. Edits are ungated (OOS-03). The app already stores documents on each asset or licence. | ~355 + table later |
| DC-API-02 | **Reports API**: 4 endpoints, test-only since Export replaced the Reports page. `buildReportData` duplicates the export queries for the same registers. | ~380 |
| DC-FE-05, DC-API-07 | **Endpoints whose screen was never built**: inspection-template create/edit/retire, PM schedule edit, WO delete, WO part-line edit, maintenance-completion history and report replace, device delete, device readings. | ~200 |
| DC-API-05/06 | Platform `POST /admin/orgs`, `/suspend`, `/restore` (kept for runbook use, but documented nowhere); `POST /admin/users/:id/invite` (no UI ever called it; it overwrites roles, OOS-16). | ~68 |
| DC-API-13/15/16 | `sms_log` table (never read or written), `documents.mime_type` (never written), PM `interval_days` / `checklist_template` and category `salvage_rate_pct` (read by SQL but impossible to set). | migrations |
| DC-API-21 | `uat/`, `audit/`, `docs/uat/` are tracked working records (~1.3 MB). They don't ship in the client tarball. | 0 code |

### Refactoring: API

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| RF-API-01 | MEDIUM | 28 routers are mounted at the root, each with a blanket auth + membership gate. Every request re-runs the gate of each router it passes: up to ~28 owner-pool queries per write. Each router's declared gate isn't its real one (profile, files), so changing the mount order changes access. | `routes/index.ts:40-70`; e.g. `sites.ts:13`; `orgMembers.ts:17-24` explains the chain |
| RF-API-01b | HIGH (security) | Write routes with no capability check: `PUT /integrations/:kind` (any member, a viewer included, can change SAP/Termii settings; OOS-01) and `PATCH`/`DELETE /documents/:id`. Reads apply `requireCap` inconsistently. | `integrations.ts:10,32`; `documents.ts:114,138` |
| RF-API-02 | MEDIUM | The caller's role is resolved 5 different ways. Approvals reads the stale JWT role for "is it waiting on you". | `approvals.ts:229-235,508-509,607`; `orgMembers.ts:50-52` |
| RF-API-05/06 | MEDIUM | No owner-pool transaction helper: 15 hand-written rollbacks in `orgMembers.ts`, and the last-owner check reads outside the transaction. | `orgMembers.ts:97-297`, `:36-63` |
| RF-API-14 | MEDIUM | The upload pipeline is copy-pasted 10 times. 6 copies skip content sniffing and the size-limit 400. | 05d table |
| RF-API-19 | MEDIUM | 4 copies of `count(*)+1` reference generation (collides; deterministic for site-scoped audit creators). Only WO refs use the safe counter. | `defects.ts:76`, `risks.ts:69`, `compliance.ts:352,594` |
| RF-API-20 | MEDIUM | Closing a work order has three paths with different side effects. Only `/transition` consumes parts and resolves defects. | `workOrders.ts:379-583`, `maintenanceEvents.ts:111-127` |
| RF-API-24 | MEDIUM | Approval notifications are raw inserts in 3 copies, bypassing preferences, dedupe and actor attribution. | `approvals.ts:194-219`, `approvalRouting.ts:55-66` |
| RF-API-09 | MEDIUM | About 10 value lists are copied between API and app, and retyped inside the API. Two different lists are both exported as `DEPRECIATION_METHODS`. | `assets.ts:61` vs `depreciation.ts:10` |
| RF-API-29/30 | MEDIUM | A test pins the retired health SQL. Depreciation maths exists in TS and SQL with no test that they agree. | `test/health.test.ts:43-59`; 05d §10 |
| RF-API-33 | MEDIUM | SQL `current_date` uses the DB server's zone (UTC) everywhere except exports. | `db.ts:45-50`, `exports.ts:627` |
| RF-API-21 | MEDIUM | Five route files of 628 to 939 lines mix CRUD, workflows and helpers. Split by sub-resource into routes and services. | line ranges in 05d §7 |
| RF-API-04,10,12,13,15,17,22,23,25,26,27,28,32,34 | LOW | Middleware imports from a route file; 82 copies of parse-or-400; three ways of mapping results to HTTP; the error middleware turns 4xx into 500; 105 audit calls repeat three fields; one hand-built SET builder; "health" names three unrelated things; a duplicated stock ledger; hand-typed recipient role lists; hand-parsed query strings and unbounded limits; copy-pasted test helpers and test files named by UAT round; small config and logging inconsistencies; untyped query rows and 202 `req.claims!`. | 05d |

### Refactoring: app

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| RF-FE-01 | MEDIUM | 13 `can()` calls omit `extraCaps`, so per-user grants are ignored on Risks, Defects, Approvals, Depreciation (OOS-07). One `useCan()` hook removes the way this happens. | `Risks.jsx:342`, `Defects.jsx:308`, `Approvals.jsx:422`, `Depreciation.jsx:354` |
| RF-FE-10/11 | MEDIUM | 4 swallowed save errors plus a blank-name profile save (OOS-09). 17 places retype sentences that already live in `errors.js`. | 05c §C |
| RF-FE-18/19/20 | MEDIUM | 7 copies of `fmtDate`; "today" in UTC in 7 places; a hardcoded ₦ in two formatters and eight labels (OOS-11, OOS-12). | 05c §E |
| RF-FE-21/22/24 | MEDIUM | Status, priority and entity maps are copied and already differ: a low-priority job is green in the asset panel but grey on Work Orders, and Analytics writes "In progress" where other pages write "In Progress". Two pill systems. | 05c §E table |
| RF-FE-13 | MEDIUM | Data loading is hand-written on every page (28 loading flags, 68 error states). Only 12 of 84 effects ignore an out-of-date response. | 05c §D |
| RF-FE-14/12 | MEDIUM | 33 hand-built modals: none closes on Escape, 8 have fixed widths, and the mobile commit's modal classes are unused. 16 `alert()` and 14 `confirm()` calls. | 05c §D |
| RF-FE-07 | MEDIUM | Five fetch wrappers that disagree on token refresh and error codes. | `apiClient.js:58,95,124,144`; `exports.js:17` |
| RF-FE-04/05 | LOW | Context values are rebuilt on every render, and auth loading has no error path (OOS-10). | 05c §A |
| RF-FE-25/26/27/28 | MEDIUM | God files: `Assets.jsx` 1,720 lines / 29 commits, `Admin.jsx` 1,689 / 18, `WorkOrders.jsx` 1,110 / 15, `Maintenance.jsx` 640 / 15. Splits are mapped out with line ranges. | 05c §G |
| RF-FE-02,03,08,09,15,16,17,23,31,32 | LOW / IDEA | Route permissions defined twice (App and Sidebar); theme passed as props to 23 pages; 12 files call the API directly; query strings built three ways; a page shell copied 23 times; form, Stat and EmptyState primitives; 2,855 inline style blocks (127 of 186 buttons override height inline); unit and smoke tests; JSDoc `checkJs` on `lib/`. | 05c |

## What passed and is worth keeping

- **API:** `withOrgContext` is the single RLS transaction path (about 180 calls, no hand-rolled tenant transactions). `writeAuditLog` is the only audit writer, and it is atomic with the change. `buildSet`/`buildInsert` take column names only from static allow-lists, so there is no SQL injection path. There is one zod-validated config. Health, depreciation and KPI maths are pure and unit-tested. No async-wrapper leftovers.
- **Tests:** 236 integration and unit tests, all passing in 11 s against real Postgres with RLS.
- **App:** `errorText()` is used 126 times. Colours use tokens well, so dark mode holds. `lib/money.jsx`, `lib/health.js` and `StatusBadge` are the right shape; they just need to be the only copies. No unused npm dependencies or public files.
- **Hygiene:** no TODOs, no `console.log`, no commented-out code, no Supabase code paths, and every env var is read.

## Prior findings

- July audit (`audit/AUDIT-REPORT.md`) C1 "sites/locations/categories write routes ungated": fixed for those three, but **the same class is still open on integrations and documents** (OOS-01, OOS-03). The fix went to the three routes named and not to their siblings.
- July M7 "zero automated tests": **fixed** (236 tests). The tests still do not gate the deploy.

## Decisions needed

Each has a recommendation, applied by default unless you say otherwise.

- **Q1 Spare Parts.** Keep it parked as is (page, API, helpers) until the Warehouse Inventory rework, and delete only `listMovements`. *Recommend keep.* If the rework will be a rewrite, say "delete" and TASK-1.4 removes ~830 lines.
- **Q2 Documents registry.** *Recommend delete* the panel, helper, 4 routes and tests now, and drop the `documents` table in a later migration after a row count. The app already stores documents on each asset or licence.
- **Q3 Reports API.** *Recommend delete* the 4 routes, `buildReportData` and their tests. Keep the `reports` file resolver and table so old generated files still download.
- **Q4 Endpoints with no screen** (template editor, PM schedule edit, WO delete, part-line edit, completion history, device delete and readings). *Recommend keep the API routes and delete the unused frontend helpers*, and add the three that look like real gaps (PM schedule edit, template editor, part-line edit) to the backlog.
- **Q5 Platform endpoints.** *Recommend keep* org create/suspend/restore and document them in `docs/OPERATIONS.md`, and *delete* `POST /admin/users/:id/invite`.
- **Q6 Behaviour changes that come with refactors.** These are all intended, but each is visible: (a) `PATCH /work-orders/:id` can no longer set `status` (it must go through `/transition`); (b) approval notifications respect preferences; (c) uploads with a mismatched content type are rejected; (d) bad input answers 4xx instead of 500; (e) error `alert()`s become toasts and confirms become in-app dialogs; (f) SQL "today" follows the instance timezone; (g) deleting an already-archived audit answers 404. *Recommend accept all.*
- **Q7 One look for priority and labels.** Low priority shows as grey (as on Work Orders and Dashboard), and labels use weight 500 (the existing `.label` class). *Recommend as stated.*
- **Q8 CI gate.** Add a check workflow (lint, typecheck, build, API tests against a Postgres service) and make the deploy wait for it. *Recommend yes.* It changes how production deploys, so it is your call.
- **Q9 Tracked UAT and audit records.** *Recommend keep* them in the repo.

## Inputs only you can supply

1. The row count of `public.sms_log` and `public.documents` on the NGML production instance, before any drop migration (TASK-1.6).

## Needs manual verification

- Whether any live asset still carries a legacy status (`attention`, `critical`), which decides if those values can ever be removed: `select status, count(*) from public.assets group by 1` on production. Not in the plan until checked.
- Whether `deploy/deploy.sh` on the VPS (not in the repo) builds before restarting. TASK-0.1 assumes it does not and puts the check in CI.

## Residual risks

- Frontend refactors change markup. The only automated net for them is the route smoke test (TASK-5.0), which checks that pages render, not how they look. Each split needs a screenshot check at 375px and desktop, in light and dark.
- The work-order close consolidation (TASK-5.1) touches stock and defects, so it has the highest regression risk in the plan. It gets its own session and new per-path tests.

## Coverage statement

- **Not run in a browser.** This is a code audit, so no workflow was exercised. Every refactor finding is `source-confirmed` or `tool`.
- **Read fully:** route mounting, every router's gate line, middleware, `db.ts`, `claims.ts`, `files.ts`, `apiClient.js`, all contexts, `App.jsx`, `Sidebar.jsx`, and the god files section by section.
- **Generated:** the 238-endpoint route table with caller matching (05b), the SQL function list, the table list, the CSS class list and the capability-string scan.
- **Sampled:** column usage (catches only distinctively named columns), page bodies under 500 lines (patterns grepped, not read line by line). `apps/admin` was checked only as an API caller.
- **Tools that ran:** knip 5.88.1, `tsc --noUnusedLocals` (clean), vitest (236/236 pass), `vite build` (passes; one 962 kB chunk), ESLint 9 dry run in a scratch folder. No ESLint, Playwright or frontend test runner exists in the repo.
- **Verified by me after the reviewers reported:** the integrations gate gap, the duplicate DELETE route, the per-router gate re-run (`routes/index.ts` + `requireActiveMembership.ts`), the 13 `can()` calls without `extraCaps`, the `count(*)+1` refs against their unique constraints, and the undefined `--a500` variable.
- **One reviewer disagreement, resolved:** 05b lists `DELETE /devices/:id` as used. It isn't: `softDeleteDevice` is imported in `Devices.jsx:6` but never called (05a DC-FE-18).
