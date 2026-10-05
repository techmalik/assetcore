# 05d Refactor audit: API (apps/api, packages/rbac)

Baseline: commit 913e934 on main. Read-only audit; no source files changed.
Severity: MEDIUM (will cause bugs), LOW (cleanliness), IDEA. Effort: S <1h, M 1-3h, L own session.

Headline: the API's foundations are sound (one RLS transaction helper used everywhere on the tenant side, one audit writer, one SET/INSERT builder, zod on every body, a clean pure-maths core for health, depreciation and KPIs). The debt is in three places: (1) how routers are mounted, which makes every router re-run the full auth and membership gate for requests it does not own; (2) write workflows living inside handlers, so the same business action (closing a work order, generating a reference, uploading a file, notifying about an approval) has two to four diverging copies; (3) no CI, so none of the 11 integration test files guard a deploy. 34 refactor items (RF-API-01 to 34) and 21 bugs seen in passing (B1 to B21); top 10 and ordering at the end.


## 1. Router gates and mounting

### RF-API-01 (MEDIUM, also performance and a security smell): every tenant router re-runs the whole gate for every request that passes through it

Plain language: each of the 29 tenant routers is mounted at the root of `/api` with no path prefix, and each one starts with a blanket `router.use(requireAuth, requireOrg, requireActiveMembership)`. In Express, a pathless `.use()` runs for every request that enters that router, whether or not one of its routes matches. So a request is checked again by every router it walks past before it reaches its own. A POST to `/api/integrity/...` (the last router) verifies the JWT about 30 times and runs the `requireActiveMembership` owner-pool query (plus a second `resolveSiteIds` query when a location scope is set) about 28 times. GETs skip the DB part but still re-verify the JWT each time. The code already knows this: `routes/orgMembers.ts:17-24` carries a comment explaining exactly this chain behaviour and is the one router that path-scopes its gate.

Evidence:
- Mount order: `apps/api/src/routes/index.ts:40-70` (`apiRouter.use(xRouter)` x 31, no prefix).
- Identical blanket gate line in 28 files, e.g. `routes/sites.ts:13`, `routes/assets.ts:17`, `routes/workOrders.ts:18`, `routes/approvals.ts:18`, `routes/integrity.ts:10` (full list: analytics, approvals, audit, categories, assets, compliance, defects, depreciation, dashboard, devices, exports, escalations, documents, integrations, inspections, integrity, licence, locations, maintenanceEvents, org, pmSchedules, notifications, risks, reports, spareParts, pmTasks, workOrders, sites).
- `middleware/requireActiveMembership.ts:24-37` (ownerPool query + `resolveSiteIds`).

Gate variations (the norm is `requireAuth, requireOrg, requireActiveMembership` blanket, then `requireCap(...)` per route):

| Router | Gate | Note |
|---|---|---|
| `routes/orgMembers.ts:24` | path-scoped `.use('/org/members', requireAuth, requireOrg, requireActiveMembership, requireCap('user:manage'))` | Only router that is correctly scoped. |
| `routes/profile.ts:9` | `requireAuth` only (blanket) | Looks like "any signed-in user, even with no org", but `sitesRouter` (mounted earlier, `index.ts:41`) already ran `requireOrg` + `requireActiveMembership` on it. The declared gate is not the real gate. A user whose JWT has `org_id: null` gets `403 no_org_context` from the sites router, not from profile. |
| `routes/health.ts` | none | Correct (public `/health`, `/version`), and works only because it is mounted before `sitesRouter`. Reordering `index.ts` would silently put `/health` behind auth. |
| `files.ts:149` `filesRouter.get('/files/*filePath', requireAuth, ...)` | per-route `requireAuth`, own inline `org_id` check | Mounted on `app` after `apiRouter` (`app.ts:34`), so in practice it also inherits the 28 blanket gates. Declared gate differs from the norm (no `requireActiveMembership`, inline `requireOrg` copy). |
| `routes/approvals.ts:301-304` | inline "either of two caps" middleware | Hand-rolled OR gate (`callerCan`) because `requireCap` takes one capability. |
| `routes/admin/index.ts:19-20` | `meRouter` before `requireAuth, requirePlatformAdmin()` | Same ordering trick as health; `me.ts:10` adds its own `requireAuth`. Fine but order-dependent. |
| `auth/routes.ts` | per-route rate limiters, no blanket gate | Mounted under `/auth` prefix, so not affected. |

Why it matters: (a) up to ~28 extra DB round trips per write, on the owner pool, which also widens the window where the pool can be exhausted; (b) a router's visible gate is not its effective gate, and the effective gate depends on mount order in `index.ts`, so moving one line can open or close routes; (c) an unknown `/api/whatever` path answers 401/403 instead of 404.

Target shape: one factory in `apps/api/src/routes/tenantRouter.ts`:

```ts
export function tenantRouter(prefix: string, opts?: { cap?: string }) {
  const r = Router()
  r.use(prefix, requireAuth, requireOrg, requireActiveMembership, ...(opts?.cap ? [requireCap(opts.cap)] : []))
  return r
}
```

Or (simpler and better) gate once in `routes/index.ts`: mount the public routers (`health`, `auth`, `admin`) first, then `apiRouter.use(requireAuth, requireOrg, requireActiveMembership)` once, then all tenant routers; delete the 28 per-file lines. `profile.ts` then states its real gate explicitly (or is mounted before the tenant gate if orgless profile access is actually wanted: a product decision, flag it). Express routers can also be given real prefixes (`apiRouter.use('/assets', assetsRouter)`) but that touches every route path string, so it is a bigger change.

Effort M (mechanical, 30 files, one-line deletions plus `index.ts`). Risk: medium. Must be verified by `apps/api/test/rbac.test.ts` plus a new test asserting that a POST runs `requireActiveMembership` once (spy on `ownerPool.query`) and that `/api/health` stays public. Do this first: every later router refactor touches the same top-of-file lines.

### RF-API-02 (MEDIUM): "who is the caller, really" is resolved five different ways, and approvals uses the stale one for its per-request checks

Plain language: `requireActiveMembership` reads the caller's live role so a just-demoted user loses rights on their next write. `claimsFromReq` and `hasCap` honour that (`membership ?? claims`). But several handlers read `req.claims!.role_key` (the JWT copy, up to 60 minutes stale) directly, so the same request can pass `requireCap` with the live role and then pass or fail the "is this waiting on you" check with the old one.

Evidence:
- Correct helpers: `claims.ts:9-16` `claimsFromReq`; `middleware/rbac.ts:28-32` `hasCap(req, cap)`.
- Re-implementations of the same `membership ?? claims` resolution: `routes/approvals.ts:229-235` `callerCan` (identical to `hasCap`), `routes/approvals.ts:730` `roleOf`, `routes/orgMembers.ts:50-52` `callerIsOwner`, inline at `approvals.ts:248`, `286`, `388`, `491`.
- Stale JWT reads in the same file: `approvals.ts:422` (event role_key on submit), `508-509` (`isOwner` and `wrong_approver` check on approve), `516`, `607` (reject gate), `620`, `668`.

Target shape: in `claims.ts` export `effectiveRole(req)`, `effectiveCaps(req)`, `isOwner(req)`; make `hasCap` accept a list (`hasAnyCap(req, [...])`) and add `requireAnyCap(...caps)` to `middleware/rbac.ts` so `approvals.ts:301-304` becomes one line. Replace every `req.claims!.role_key` / `req.claims?.role_key` in routes with `effectiveRole(req)`. Note: switching approve/reject to the live role is a (desired) behaviour change for the 60-minute stale window, so call it out in the commit. Effort S. Risk low.

### RF-API-03 (IDEA): capability strings are untyped

`requireCap(capability: string)` (`middleware/rbac.ts:14`) and `packages/rbac/index.d.ts:3-7` type capabilities as `string`; there are 138 `requireCap(` call sites using 38 distinct strings. A typo silently 403s everyone. All 38 used strings exist in the role map today except `depreciation:manage`, which is intentionally owner-only via `'*'` (`packages/rbac/index.js:23`) and so is never listed anywhere. Target: export a `CAPABILITIES` const tuple from `packages/rbac` (including owner-only ones like `depreciation:manage`, `integration:manage`) and type `Capability` from it in `index.d.ts`. Effort S. Risk low. Also delete the defensive cast `(rbac as { ROLE_RANK?: ... }).ROLE_RANK ?? {}` at `approvals.ts:321-323`; `ROLE_RANK` is exported (`packages/rbac/index.d.ts:10`).

### RF-API-04 (LOW): middleware imports from a route module

`middleware/requireActiveMembership.ts:3` imports `resolveSiteIds` from `auth/routes.ts:78`. Middleware depending on a router file is a layering inversion and means any test that touches the middleware loads the whole auth router (rate limiters, mailer). Target: move `resolveSiteIds` and `resolveOrgRole` (`auth/routes.ts:43-93`) to `apps/api/src/auth/membership.ts`. Effort S. Risk low.

## 2. Transactions and DB access

Summary: the tenant side is in good shape. `withOrgContext` (`db.ts:38-60`) is the single helper that takes a client, `begin`s, sets `app.org_id / user_id / role_key / site_ids` with `set_config(..., true)`, commits, rolls back on throw and always releases. All 31 tenant route files go through it (about 180 calls; heaviest: compliance 21, workOrders 19, assets 17, approvals 16). No tenant route calls `pool.connect()` or `begin` by hand. The inconsistency is entirely on the owner-pool side, where there is no helper.

### RF-API-05 (MEDIUM): no owner-pool transaction helper, so five hand-rolled BEGIN/ROLLBACK/release copies and six bare connect/release copies

Evidence (hand-rolled transactions on `ownerPool`):
- `routes/orgMembers.ts:97-161` (invite), `171-201` (role), `226-263` (access), `270-297` (`setStatus` factory). Between them there are 15 early-return `await client.query('rollback'); return res.status(...)` lines (e.g. `108`, `112`, `175`, `178`, `183`, `230`, `231`, `236`, `241`, `245`, `274`, `275`, `278`, `281`). Each early return relies on the author remembering the rollback; one missed line leaves a connection returned to the pool mid-transaction (pg will not auto-rollback on `release()`), so the next request that borrows it runs inside someone else's open transaction.
- `routes/admin/users.ts:70-100` (platform invite): commits at `:89`, then sends mail and writes the platform audit log; if either throws, the `catch` at `:96` issues `rollback` on a committed connection (harmless warning, but shows the pattern is copy-pasted, not designed).
- Bare `ownerPool.connect()` + `try/finally release()` with no transaction: `auth/routes.ts:101-107`, `148-154`, `174-179`, `219-230`, `242-256`, `273-282`; `routes/orgMembers.ts:305-320`; `routes/admin/users.ts:109-119`.

Target shape, in `db.ts` next to `withOrgContext`:

```ts
export async function withOwnerTx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T>   // begin/commit/rollback/release
export async function withOwnerClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> // connect/release only
```

Handlers return a typed result (`{ error: 'owner_only' }` or data) from the callback and map it to HTTP after the transaction, exactly as tenant routes already do with `withOrgContext`. That removes all 15 manual rollbacks. Effort M (orgMembers is the bulk). Risk low-medium; covered by `test/rbac.test.ts` and `test/attributionAndAudit.test.ts` (member flows). Can run in parallel with anything that does not touch `orgMembers.ts` / `auth/routes.ts`.

### RF-API-06 (MEDIUM): reads inside the orgMembers "transactions" do not use the transaction

Plain language: `getOrgMembership` (`orgMembers.ts:55-63`) and `countActiveOwners` (`:36-42`) call `ownerPool.query` directly, not the `client` that holds the open transaction. So the "is this the last owner?" check reads outside the transaction and takes no lock; two admins demoting the last two owners at the same moment can both pass. Fold into RF-API-05: pass the client in and lock with `select ... for update`. Effort S as part of RF-API-05. (Also listed under bugs.)

### RF-API-07 (LOW): site-shutdown guard runs in its own transaction before the create

`routes/workOrders.ts:276`, `:347`, `routes/inspections.ts:94`, `routes/pmSchedules.ts:58` each open a whole extra `withOrgContext` (connect, begin, 4 GUCs, commit) just to call `isSiteShutdown`, then open a second one for the insert. `routes/assets.ts:320` and `:492` do it correctly inside the main transaction. Target: move the call inside the main callback and return `{ error: 'site_shutdown' }`, like assets.ts. Halves the connections for those creates and removes a check-then-act gap. Effort S. Risk low (`test/siteShutdownAndTransfer.test.ts` covers it).

### RF-API-08 (LOW): `/org/settings` does three autocommit owner-pool writes and no audit row

`routes/org.ts:107-131`: read `before`, update, then optionally `recompute_asset_depreciation`, each a separate autocommit `ownerPool.query`. A failure in the recompute leaves the settings changed and the register stale; no `writeAuditLog` call even though the depreciation policy changes every asset's book value (the sibling `PATCH /org` at `:66-93` has no audit row either). Target: `withOwnerTx` plus `writeAuditLog(c, { action: 'org.settings', before, after })`. Adding the audit row is a behaviour addition; flag it. Effort S.

### RF-API-01b (security smell, logged for the security pass): mutating tenant routes with no capability gate

Found while counting gate variations. These write routes have only the blanket membership gate and no `requireCap`, so any active member, including `viewer`, can call them. RLS on these tables checks `org_id` only.

| Route | Evidence | What the rest of the code expects |
|---|---|---|
| `PUT /integrations/:kind` | `routes/integrations.ts:32` (no cap); RLS `db/migrations/0001_baseline.sql:977-979` org-only | `integration:manage`, owner-only per `packages/rbac/index.js:22`; the UI gates on it (`apps/app/src/pages/Integrations.jsx:206`). No API code checks `integration:manage` anywhere. |
| `PATCH /documents/:id`, `DELETE /documents/:id` | `routes/documents.ts:114`, `:138`; RLS `0021_asset_master_and_documents.sql:147-148` org-only | Upload (`:62-70`) checks the parent's capability; edit/delete check nothing. |
| `POST /documents` | `routes/documents.ts:70` uses `can(req.claims?.role_key, cap)` | Ignores `extra_caps` and the fresh membership role (another RF-API-02 copy). |

Reads with no `requireCap` (intended "any member" per comments in most cases, listed for completeness): `GET /work-orders`, `/work-orders/:id`, `/work-orders/:id/tasks`, `/work-orders/:id/parts` (`workOrders.ts:120,135,672,756`), `GET /assets*` (`assets.ts:156,176,193,199,209,262`), `/pm-schedules`, `/pm-tasks`, `/inspections`, `/inspection-templates`, `/inspections/:id`, `/compliance-licences*`, `/devices*`, `/dashboard/*`, `/analytics/asset-map`, `/analytics/calendar`, `/exports`, `/exports/:dataset` (the latter checks per dataset inside), `/integrity/overview`, `/documents`, `/categories`, `/locations*`, `/sites`. Every other read in the same files carries `requireCap('x:read')`, so the inconsistency is the smell: either every read takes its `:read` cap or none does. Since every role has `*:read` or the specific read cap today the behaviour is the same, which is exactly why it will drift.

Target: with the `tenantRouter` / single-gate change, add an explicit `requireCap` to every route (a lint-style test in `test/rbac.test.ts` can walk `apiRouter.stack` and fail on any tenant route without a `requireCap` layer unless it is on an allow-list with a reason).

## 3. Validation and shared enums

### RF-API-09 (MEDIUM): the same value lists are typed out many times, and two different lists share one exported name

Plain language: the allowed values for priorities, severities, work order types and statuses are typed inline in zod schemas across several route files, even where an exported constant for the same list already exists a few files away. The app keeps its own copies (as `[value, label]` tuples) in `apps/app/src/lib/db/*.js`. Today the copies match, with the exceptions below; nothing makes them keep matching.

API-side duplicates:
- Priority `['low','medium','high','critical']`: inline at `routes/workOrders.ts:113`, `routes/defects.ts:218`, `routes/escalations.ts:51`; same values as `CRITICALITIES` (`routes/assets.ts:63`).
- Defect severity `['minor','moderate','major','critical']`: exported as `DEFECT_SEVERITIES` (`routes/defects.ts:17`) but retyped inline at `routes/compliance.ts:571` and `routes/escalations.ts:52`.
- WO type `['corrective','preventive','inspection','emergency']`: inline at `workOrders.ts:111` and `defects.ts:221`; analytics keeps a subset `FAILURE_TYPES` (`analytics.ts:16`).
- WO status: inline at `workOrders.ts:112`, and again as the keys of `WO_TRANSITIONS` (`workOrders.ts:47-55`) and `WO_STATUS_LABEL` (`:56-59`).
- Inspection kinds: exported as `INSPECTION_KINDS` (`inspections.ts:29`) and retyped inline 23 lines later at `inspections.ts:52`.
- `DEPRECIATION_METHODS` is exported from two modules with different contents: `routes/assets.ts:61` = `none, straight_line, declining_balance, sum_of_years_digits` (the asset column) and `depreciation.ts:10` = `straight_line, declining_balance, sum_of_years_digits, units_of_production` (schedule methods, matching `db/migrations/0022_parts_and_depreciation.sql:187`). Same name, different meaning; an import from the wrong file type-checks.
- `OPEN_STATUSES` (`defects.ts:19`) / `LIVE_STATUSES` (`risks.ts:19`) are untyped `string[]` subsets that are not derived from the full lists.

API vs app copies (checked value by value):

| List | API | App | Drift |
|---|---|---|---|
| WO transitions | `workOrders.ts:47-55` | `apps/app/src/lib/db/workOrders.js:6-14` | identical today, two hand copies |
| WO status labels | `workOrders.ts:56-59` | `lib/db/workOrders.js:16-24` | identical |
| WO status order | `workOrders.ts:112` | `apps/app/src/pages/WorkOrders.jsx:27` `STATUS_COL_ORDER` | identical |
| Defect severities / statuses / open | `defects.ts:17-19` | `lib/db/defects.js:6-26` | identical |
| Risk categories / statuses | `risks.ts:16-17` | `lib/db/risks.js:3-17` | identical |
| Escalation entity types, `VALID_TRIGGERS` | `escalations.ts:16-31` | `lib/db/escalations.js:3-21` (comment says "Mirrors VALID_TRIGGERS") | identical |
| Audit outcomes, finding severities | `compliance.ts:283-284` | `lib/db/complianceLicences.js:99-114` | identical |
| Depreciation (schedule) methods | `depreciation.ts:10-15` | `lib/db/depreciation.js:3-8` | identical |
| Integrity statuses | `integrity.ts:19` | `lib/db/integrity.js:4-12` (keys of a style map) | identical, order matters for ranking (`Integrity.jsx:70`) |
| Asset status | `assets.ts:27` (7 values) | `apps/app/src/pages/Assets.jsx:63-72` (picker 3, legacy 2, filter 7) | identical set; `AssetMapPage.jsx:103` filter offers 5 and omits `maintenance`, `standby` (UI gap, not API drift) |

No value-level drift today. The risk is structural: 10 lists with two hand copies each, plus the in-API retypes.

Target shape: a new workspace package `packages/domain` (or widen `packages/rbac` into `packages/shared`; a new package is cleaner) exporting plain `as const` arrays plus `WO_TRANSITIONS`, built the same way `@assetcore/rbac` is (`index.js` + `index.d.ts`, no build step). Labels stay in the app (they are presentation), keyed by the shared values, so the app's `[value, label]` tuples become `VALUES.map(v => [v, LABEL[v]])`. Rename the two depreciation lists `ASSET_DEPRECIATION_METHODS` and `SCHEDULE_METHODS`. Route files import from the package and stop exporting enums (several are exported only so other route files can import them across routers, e.g. `approvals.ts:39` re-exports `ROLE_KEYS` for `escalations.ts`). Effort M (API S, app M). Risk low. Sequential after nothing; parallel-safe with the router work if done file-by-file, but it touches the top of the same route files, so better after RF-API-01.

### RF-API-10 (LOW): 82 copies of the same parse-or-400 block

`const parsed = X.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: 'invalid_request' })` appears 82 times across `routes/` and `auth/` (grep `safeParse(` = 82, `error: 'invalid_request'` = 82). The issue list is always thrown away, so a client that sends a bad field gets no hint which one (UAT rounds have repeatedly had to diagnose this from the DB side). Variants: `req.body` vs `req.body ?? {}` (approvals.ts uses the latter on 8 routes, others not), and `routes/admin/users.ts:67` does `const { email, ... } = req.body ?? {}` with no schema at all.

Target: `apps/api/src/http/validate.ts` with `parseOr400(schema, value, res)` returning the data or `undefined` (having already answered), or a `validateBody(schema)` middleware that stores `req.valid`. Optionally include `issues: parsed.error.flatten().fieldErrors` in the 400 body (behaviour change, additive). Also move the 17 copies of the `YYYY-MM-DD` regex (11 files, e.g. `approvals.ts:350`, `org.ts:61`, `maintenanceEvents.ts:28`, `workOrders.ts:85`) and `blankToUndefined` (`maintenanceEvents.ts:22`) into `apps/api/src/http/zod.ts` as `isoDate`, `uuid`, `money`. Effort M (mechanical). Risk low.

### RF-API-11 (LOW): create and patch schemas are mostly fine

17 routes derive the patch schema with `.partial()` from the create schema (e.g. `approvals.ts:126`, `pmSchedules.ts:80`), which is the right pattern. Exceptions that hand-build a second schema: `compliance.ts:535` (`findingInput.partial().extend({ status })`) and `compliance.ts:571` (a separate inline object for defect promotion). No action beyond RF-API-09's enum import.

## 4. Error handling and response shape

Summary: there is one error middleware (`app.ts:41-44`) that logs and answers `500 internal_error`. No leftover async wrappers: no `asyncHandler`, `catchAsync` or `.catch(next)` anywhere, so Express 5's native promise handling is relied on correctly. Every expected failure is answered inline as `res.status(n).json({ error: '<snake_code>' })`; 72 distinct codes, consistently snake_case (`not_found` x115, `invalid_request` x82, `empty_patch` x30, `forbidden` x14). Domain errors are never thrown; the only custom error class is `UnsupportedMethodError` (`depreciation.ts:36`). Inside transactions, handlers return a sentinel (`null` for 404, or `{ error: 'code' as const }`, 78 such returns) and map it to HTTP after the callback. That pattern is sound because it keeps the rollback/commit decision in `withOrgContext`; what is inconsistent is the mapping.

### RF-API-12 (LOW): three styles for mapping a transaction's result to HTTP

- If-chains per route: `approvals.ts:439-448`, `579-585`, `637-643`, `679-683`; `workOrders.ts` (5 `'error' in` checks), `assets.ts` (3), `escalations.ts` (3), and one or two each in `sites`, `inspections`, `compliance`, `depreciation`, `defects`, `risks`, `spareParts`, `reports`, `maintenanceEvents`.
- A status table plus sender: `approvals.ts:708-728` (`DIRECT_HTTP_STATUS`, `sendDirect`), used by 5 routes in the same file but not by the 4 routes above it.
- `null` meaning 404 (most CRUD routes).

Target: promote `sendDirect` to `apps/api/src/http/result.ts`:

```ts
export type Result<T, E extends string> = { data: T } | { error: E; [k: string]: unknown }
export function send<E extends string>(res, result, statusFor: Record<E, number>, okStatus = 200)
```

with one shared `ERROR_STATUS` table for the common codes (`not_found: 404`, `not_pending: 409`, `self_approval: 403`, `site_shutdown: 422`, ...) that routes extend locally. Removes about 40 lines from approvals.ts alone and makes the code-to-status mapping greppable in one place (useful for the app's error copy too). Effort M. Risk low (status codes asserted in tests).

### RF-API-13 (LOW, small bug): the error middleware turns client errors into 500

`app.ts:41-44` ignores `err.status` / `err.statusCode`. Malformed JSON from `express.json()` (`type: 'entity.parse.failed'`, status 400), an oversized body (413), and multer errors on the 6 upload routes that do not use `guardedSingle` all answer `500 internal_error` and log at error level. Postgres constraint violations (unique `23505`, FK `23503`, check `23514`, bad uuid `22P02`) also surface as 500; no code maps any pg error code (grep for `23505` etc. finds nothing), so for example a malformed `:id` path param answers 500 rather than 404/400. Target: in the error middleware, honour `err.status` when 4xx, and map `22P02` to 400 `invalid_request`, `23505` to 409 `conflict`, `23503` to 422 `invalid_reference`. Behaviour change (500 to 4xx), so treat as a fix with tests. Effort S.

### RF-API-14 (MEDIUM, also a security smell): the upload pipeline is copy-pasted and half the copies skip validation

Every upload route repeats: multer middleware, `if (!req.file) 400 missing_file`, build `subdir/filename` url, `try { withOrgContext(...) } catch { cleanupOrphanedUpload; throw }`, `if (!row) { cleanupOrphanedUpload; 404 }`. The safety steps are applied unevenly:

| Route | `guardedSingle` (size to 400) | magic-byte `validateUploadOrCleanup` |
|---|---|---|
| `POST /assets/:id/photos` `assets.ts:645` | yes | yes |
| `POST /assets/:id/documents` `assets.ts:697` | yes | yes |
| `POST /assets/:id/maintenance-completions` `maintenanceEvents.ts:66-84` | yes | yes |
| `POST /maintenance-completions/:id/report` `maintenanceEvents.ts:180-186` | yes | yes |
| `POST /work-orders/:id/attachments` `workOrders.ts:585` | no | no |
| `POST /pm-tasks/:id/report` `pmTasks.ts:174` | no | no |
| `POST /inspections/:id/report` `inspections.ts:239` | no | no |
| `POST /compliance-licences/:id/document` `compliance.ts:127` | no | no |
| `POST /compliance-audits/:id/document` `compliance.ts:184` | no | no |
| `POST /documents` `documents.ts:62` | no | no (also stores the client-sent `req.file.mimetype`, `:90`) |

Target: one factory in `files.ts`:

```ts
export function uploadRoute(opts: { subdir: string; field: string; mime: readonly string[]; maxBytes?: number },
  handler: (req, res, file: { url: string; name: string; size: number }) => Promise<...>)
```

that applies `guardedSingle`, sniffing, the `missing_file` check, url building, and the cleanup-on-throw/cleanup-on-null wrapper. The six unvalidated routes gaining sniffing is a behaviour change (a renamed `.exe` stops being accepted), which is the intent; say so in the commit. Effort M. Risk medium (upload tests exist in `test/uatRound2.test.ts` / `uatRound3.test.ts` for some routes; add one per route). Also note `files.ts:121-138` `FILE_OWNERSHIP_CHECKS` has no `documents` entry, so anything `POST /documents` stores under `documents/` can never be downloaded (`files.ts:157-160` default-deny). The documents router is unreachable from the UI per `05b-dead-code-api.md:144-147`, so this only matters if it is kept.

## 5. Audit logging

Summary: good. `writeAuditLog` (`audit.ts:17-38`) is the only writer of `public.audit_log`; there is no inline `insert into public.audit_log` anywhere in `apps/api/src` and no SQL function writes it. 105 calls across 21 files (approvals 12, compliance 11, assets 10). It takes the transaction client, so audit rows commit atomically with the change. Platform side likewise uses `writePlatformAuditLog` only.

### RF-API-15 (LOW): every call repeats the same three fields, and the tenant side never records the IP

Every call spells out `orgId: rows[0].org_id, actorId: req.claims!.sub, ...` (the org id is fetched with `returning id, org_id` purely to feed the audit call in dozens of queries, e.g. `pmSchedules.ts:83`, `approvals.ts:110`). `ip` is accepted by the helper but only 1 of 105 tenant calls passes it (`routes/exports.ts`), while every platform call does (`routes/admin/*.ts`, 15 calls). Target: `auditFromReq(c, req, { action, entityType, entityId, before?, after? })` in `audit.ts` that fills `orgId` from `req.claims.org_id`, `actorId` from `req.claims.sub`, `ip` from `req.ip`. Filling `ip` is additive. The `returning ..., org_id` columns can then go. Effort M (mechanical, 105 sites; can be done file by file alongside other edits). Risk low; `test/attributionAndAudit.test.ts` covers it.

### RF-API-16 (LOW, governance gap): mutations with no audit row

Mutating routes that write no audit entry: `PATCH /org` and `PATCH /org/settings` (`org.ts:65`, `:107`), `PUT /integrations/:kind` (`integrations.ts:32`), `PATCH /profile` (`profile.ts:31`), work order tasks and parts lines (`workOrders.ts` POST/PATCH/DELETE `/work-orders/:id/tasks*` and `/parts*`, 6 routes; parts lines move stock), `POST/DELETE /spare-parts/:id/assets*` (`spareParts.ts`), `POST /compliance-audits/:id/findings` and `PATCH .../findings/:findingId` (`compliance.ts`), `PATCH/DELETE /inspection-templates/:id` (`inspections.ts`), `PATCH /documents/:id`, `POST /depreciation/preview` (read-only, fine), `POST /escalation-rules/run` and `POST /compliance/check-expiry` (job triggers). Not a refactor; listed so whoever adds `auditFromReq` can close them in the same pass. Also `orgMembers.ts:149-152` logs the invite with `entityType: 'membership'` but `entityId: userId` (every other membership action uses the membership id), so `resolve_audit_label` resolves it against the wrong table.

Also inconsistent: `after:` is sometimes the parsed patch (`pmSchedules.ts:88`), sometimes the whole joined SELECT row including denormalised names (`inspections.ts:126` `after: inspection`, `pmSchedules.ts:70`). IDEA: standardise on "the parsed input" for updates and "the inserted row (base table only)" for creates.

## 6. PATCH builders and dynamic SQL

Summary: good. `sqlUtil.ts` `buildSet` / `buildInsert` are used by 20 / 10 route files (24 `buildSet(` calls) and there are no competing copies, with one exception. Column names only ever come from a static per-route `ALLOWED` list intersected with zod-parsed keys (zod already strips unknown keys), so there is no column-name injection path.

### RF-API-17 (LOW): one hand-rolled SET builder

`routes/orgMembers.ts:217-224` builds `sets.push('site_scope = $n')` by hand because `extra_caps` needs `?? []` and `'key' in parsed.data` semantics. Target: normalise first (`if ('extra_caps' in d) d.extra_caps ??= []`) and call `buildSet(d, ACCESS_ALLOWED, 2)`. Effort S, fold into RF-API-05.

### RF-API-18 (IDEA): `buildSet` cannot express "where id = $1 and org_id = $2"

`leadingParams` covers it, but callers compute it by hand (`orgMembers` uses 2, `org.ts:78` and `profile.ts:34` use 0, everyone else 1). A tiny `updateById(c, table, id, patch, allowed, returning)` would remove the `update public.x set ${setSql} where id = $1 returning id, org_id` line repeated in about 20 handlers. Optional.

Security note on dynamic SQL (no injection found): fragments interpolated into SQL are all constants or builder output: `${SELECT}` style constants, `${setSql}/${columns}/${placeholders}` from `sqlUtil`, `${locClause}`/`${locSites}` constant strings selected by a boolean (`dashboard.ts:49-253`, `integrity.ts:137-176`), `${likelihoodExpr}` constants (`risks.ts:137`), `LIMIT_SQL` constant (`exports.ts:91`), and the `$?` placeholder helpers (`defects.ts:91`, `exports.ts:74-86`). All user values are bound parameters.

### RF-API-19 (MEDIUM): four copies of "next reference number", three of them racy and one wrong under site scope

- `generateWoRef` (`workOrders.ts:189-191`) calls `public.next_wo_ref(current_org_id())`, a counter table with `on conflict do update` (`db/migrations/0011_wo_ref_counter.sql:17-51`). Correct.
- `generateDefectRef` (`defects.ts:76-80`), `generateRiskRef` (`risks.ts:69-72`), `generateAuditRef` (`compliance.ts:352-355`), and an inline fourth copy of the defect one (`compliance.ts:594-596`, raising a defect from an audit finding) all do `select count(*) ... where ref like 'XXX-<year>-%'` then `+1`.

Problems: (a) two concurrent creates get the same number and the second hits `unique (org_id, ref)` (`0023_defects_and_governance.sql:54`, `0024_risk_audits_currency.sql:69`, `:162`) and answers 500; (b) the count runs on the RLS pool, and `compliance_audits` has a site-scoped select policy (`0005_compliance_iso.sql:55-56`), so a site-scoped user counts only their sites' audits and generates a number that already exists elsewhere in the org: a deterministic 500, not a race; (c) the year comes from Node's clock (`new Date().getFullYear()`) while WO refs use the DB's. Target: generalise `wo_ref_counters` into `ref_counters (org_id, prefix, year, next_seq)` with `public.next_ref(org, prefix)` (security definer so RLS does not affect it), and one TS helper `nextRef(c, 'DEF')`. This is a migration plus 5 call sites. Effort M. Risk low-medium (backfill counters from current max per prefix/year, like 0011 did at `:51`).

## 7. Domain logic in route files

Existing service modules and what they own: `approvalRouting.ts` (shared approval SELECT, events, direct-route insert and outcome), `healthService.ts` (DB half of asset health), `health.ts` (pure scoring), `depreciation.ts` (pure schedule maths), `kpis.ts` (pure KPI maths), `siteShutdown.ts` (one guard), `reportBuilders.ts` (saved-report datasets plus CSV/XLSX rendering), `notify.ts` (wrappers over the SQL notify functions). The pure modules are well separated and unit-tested. What is missing is a service layer for the write workflows, which live inside handlers.

### RF-API-20 (MEDIUM, with a real bug): three different ways to close a work order, with different side effects

Plain language: closing a job is supposed to draw its parts out of stock, resolve the defect it came from, stamp `actual_end`, notify the creator and assigner, sync the asset's status, and refresh asset health. Only the `/transition` endpoint does all of that. Two other code paths set `status = 'closed'` directly and skip most of it.

| Path | Transition rules | Parts consumed | Defects resolved | `actual_end` | Notify closed | Asset status sync | Health refresh |
|---|---|---|---|---|---|---|---|
| `POST /work-orders/:id/transition` `workOrders.ts:482-583` | yes (`WO_TRANSITIONS`, `:493`) | yes (`consumeParts`, `:434-480`) | yes (`:529-540`) | yes | yes | yes | yes |
| `PATCH /work-orders/:id` with `status` in body `workOrders.ts:379-421` (`status` is in `ALLOWED`, `:25`, and in `woInput`, `:112`) | no | no | no | no | no | yes (`:413-415`) | no |
| Maintenance completion closing a linked WO `maintenanceEvents.ts:111-127` | no (`status <> 'closed'` only) | no | no | no | yes | no | asset-level only (`:134`) |

`POST /work-orders` also accepts any `status` (including `closed`) on create (`workOrders.ts:112`, `:355`). Target: `apps/api/src/services/workOrders.ts` exporting `transitionWorkOrder(c, woId, to, { actorId, comment, report })` returning `Result<Wo, 'not_found' | 'invalid_transition' | 'insufficient_stock'>`, plus `recordAssignment`, `syncAssetStatusForWorkOrder`, `consumeParts`, `generateWoRef` moved out of the router (`workOrders.ts:189-256`, `:434-480`). `/transition`, the PATCH (when `status` is present) and `maintenanceEvents` all call it. Removing `status` from PATCH `ALLOWED` (or routing it through the service) is a behaviour change; check `apps/app` first (the app uses `/transition` for status moves per `lib/db/workOrders.js`). Effort L (own session). Risk medium-high (stock, defects); tests: `test/attributionAndAudit.test.ts`, `test/assignmentNotifications.test.ts`, `test/siteShutdownAndTransfer.test.ts`, and add a parts-consumption test per path.

### RF-API-21 (MEDIUM): split the five god routers by sub-resource

Each split is behaviour-preserving if done as "move code, re-export router", one file at a time. Target layout: `routes/<area>/index.ts` that composes sub-routers, plus `services/<area>.ts` for the workflow functions. Line ranges at baseline:

`routes/approvals.ts` (939):
- 1-52 setup, enums (`APPROVAL_ENTITY_TYPES`, `APPROVAL_KINDS`; to the shared enums package, RF-API-09), `RULE_SELECT`.
- 54-190 approval matrix CRUD (`/approval-rules`) -> `routes/approvals/rules.ts`.
- 192-235 local helpers `notifyRole`, `notifyUser`, `eventsFor` (pure alias of `approvalEvents`), `callerCan` -> delete (RF-API-02, RF-API-24).
- 237-341 read endpoints (list with scope filter, stats, approvers, get) -> `routes/approvals/read.ts`.
- 343-450 submit (matrix routing: band lookup, first level) -> `services/approvals.ts` `submitApproval()`; route keeps parse and response.
- 452-685 matrix decisions approve/reject/recall -> `services/approvals.ts` `approveStep()`, `reject()`, `recall()`. The matrix-approve branch for `route = 'direct'` (`:480-506`) duplicates the direct-route logic at 687-939.
- 687-939 direct route (forward/return/discard/resubmit), already factored with `lockForAssignee`, `recordDirectEvent`, `sendDirect` -> `routes/approvals/direct.ts`; the helpers move to `approvalRouting.ts`.
- Repeated in this file: the `insert into approval_events` statement 4 times outside `recordDirectEvent` (`:420`, `:488`, `:514`, `:617`, `:665`; `approvalRouting.ts:135` is a sixth); "load row plus events" 4 times (`:435-436`, `:575-576`, `:633-634`, `:675-676`) where `loadApproval` exists.

`routes/workOrders.ts` (859):
- 17-118 setup, `ALLOWED`, `REPORT_FIELDS`, `WO_TRANSITIONS`, `WO_STATUS_LABEL`, `SELECT`, `woInput`.
- 120-188 list and detail (`/work-orders/:id` opens three separate `withOrgContext` transactions, `:135-188`; one would do).
- 189-256 helpers -> `services/workOrders.ts`.
- 257-333 `createForApproval` -> service.
- 334-421 create, patch.
- 423-583 transition + `consumeParts` -> service (RF-API-20).
- 585-660 attachments, comments, delete -> attachments via `uploadRoute` (RF-API-14).
- 662-744 task checklist -> `routes/workOrders/tasks.ts`.
- 745-859 parts lines -> `routes/workOrders/parts.ts` (shares stock logic with `spareParts.ts`; `consumeParts` and the `/spare-parts/:id/adjust` ledger write both insert `stock_movements` by hand).

`routes/assets.ts` (775):
- 16-143 setup, enums, `ALLOWED`, `SELECT`, `assetInput`.
- 144-155 `recomputeDerived`, `maintenanceDatesOrdered` -> `services/assets.ts`.
- 156-308 reads (list, by-ain, health preview, detail, activity, transfers) and the comment endpoint.
- 309-350 create.
- 351-469 CSV import (120 lines of lookup-map building and per-row insert) -> `services/assetImport.ts`.
- 470-523 patch.
- 524-644 transfer (120 lines; moves open WOs, PM tasks, inspections, schedules) -> `services/assetTransfer.ts`.
- 645-746 photos and documents -> `uploadRoute` (RF-API-14).
- 747-775 archive and restore.

`routes/exports.ts` (667):
- 24-96 types, filter helpers (`Where` builder, `applyFilters`, `UUID`, `DAY` regexes duplicating RF-API-10's helpers).
- 97-560 `DATASETS` registry: 11 dataset definitions with their SQL (`assets` 99, `work_orders` 151, `pm_history` 198, `maintenance_events` 234, `inspections` 271, `defects` 306, `risks` 347, `compliance_licences` 392, `sites` 441, `asset_transfers` 481, `audit_log` 523) -> `exports/datasets/*.ts`, one file per dataset, registry in `exports/index.ts`.
- 561-591 `schemaFlags`, `filtersFor`, `parseCommon`. `schemaFlags` (`:561-569`) probes `information_schema` at runtime for `asset_transfers`, `sites.status`, `sites.shutdown_at`; since migrations ship with the build these are always true on a current instance, so the `available`/`filters` function forms exist only for half-migrated databases (IDEA: drop it, or replace with a boot-time check).
- 592-667 the two routes (small; stay).
- Overlap: `reportBuilders.ts:20-140` `buildReportData` implements `asset_register`, `wo_summary`, `compliance_register`, `pm_history` for saved reports (`routes/reports.ts`), a second SQL for the same four registers as `exports.ts` `assets`, `work_orders`, `compliance_licences`, `pm_history`. The two already share the renderers (`renderCsv`, `renderXlsx`). Target: saved reports call the export dataset builders (with no filters) so there is one query per register. Behaviour change in columns, so check the saved-report UI first. Effort M.

`routes/compliance.ts` (628):
- 13-175 licences CRUD and documents.
- 176-217 audit document upload, and a `DELETE /compliance-audits/:id` at `:207-216` that duplicates and shadows the one at `:492-508` (Express takes the first match, so the later one, which has the `and deleted_at is null` guard, never runs; see bugs).
- 218-231 licence delete (separated from the rest of licence CRUD).
- 232-275 check-expiry and pm-compliance.
- 276-509 audits (enums, SELECT, schema, `generateAuditRef`, CRUD).
- 510-628 findings, including raising a defect from a finding (`:569-628`, which hand-copies defect ref generation and defect insert from `defects.ts`).
- Target: `routes/compliance/licences.ts`, `routes/compliance/audits.ts`, `routes/compliance/findings.ts`; `services/defects.ts` `createDefect()` shared by `defects.ts:150` and `compliance.ts:594-610`.

Effort per file: M each (L for workOrders with RF-API-20). Risk low for pure moves. Parallel-safe across different files once RF-API-01 has landed (otherwise every split conflicts on the gate line).

### RF-API-22 (LOW): health.ts vs healthService.ts vs routes/health.ts

- `health.ts` (239 lines): pure scoring (`computeHealth`, `HEALTH_WEIGHTS`), no DB. Unit-tested by `src/health.test.ts`.
- `healthService.ts` (226 lines): the DB half: gathers signals (`SIGNALS_SQL`), calls `computeHealth`, writes through `apply_asset_health()` so the 50%/30% crossings fire. Exports `previewAssetHealth`, `recomputeAssetHealth`, `recomputeAllHealthScores` (cron, `jobs.ts:24`), `refreshAssetHealth` (7 route callers). Integration-tested by `test/health.test.ts`.
- `routes/health.ts` (32 lines): unrelated. It is the liveness probe (`GET /health`, `GET /version`).

The first two are a clean split (pure core plus DB shell), not duplication. The problem is the name collision: "health" means asset condition in two files and server liveness in the third, and there are two `health.test.ts` files (`src/health.test.ts` unit, `test/health.test.ts` integration). Target: rename `routes/health.ts` to `routes/system.ts` (`systemRouter`), and optionally `health.ts`/`healthService.ts` to `assetHealth/score.ts` and `assetHealth/service.ts`. Also `routes/admin/version.ts` (26 lines) duplicates `/version` for the backoffice. Effort S. Risk low. Old SQL `public.recompute_asset_health(uuid)` (`db/migrations/0003_health_lifecycle.sql:18`, redefined `0007:137`) appears to be superseded by `healthService.ts`; dead-code auditor's call.

### RF-API-23 (LOW): stock ledger writes duplicated between work orders and spare parts

`consumeParts` (`workOrders.ts:434-480`) and the spare-part adjust route (`spareParts.ts:215-245`, plus the opening-balance insert at `:143`) each lock the part row, compute `balance_after`, update `quantity_in_stock` and insert a `stock_movements` row by hand. Target: `services/stock.ts` `moveStock(c, { partId, qty, kind, reason, workOrderId? })`. Effort S-M. Risk medium (ledger).

## 8. Notifications

Summary: the intended path is the two security-definer SQL functions `public.notify_users` and `public.notify_role_holders` (`db/migrations/0014_activity_assignment_notifications.sql:32`, `:91`; `notify_users` redefined `0017_assignment_attribution.sql:79`). They de-duplicate, drop the actor, honour `notification_preferences`, and site-filter role holders. `notify.ts` wraps them and is used by inspections (4), maintenanceEvents (3), pmTasks (3), workOrders (3). SQL jobs (`run_escalations`, `notify_pm_due`, site shutdown in `0027_site_shutdown_and_transfers.sql:222-586`) call the same functions. Work order assignment notifications fire from a trigger (`trg_notify_wo_activity`) off the activity row (`workOrders.ts:194-196` comment).

### RF-API-24 (MEDIUM, behaviour gap): approvals bypass the notification helpers

Plain language: every approval notification is a raw `insert into public.notifications`, so approvals ignore the user's notification preferences, do not de-duplicate, and the role broadcast is not site-scoped (a site-scoped supervisor at site A is told about an approval for a site-B job they cannot open; `approvals` itself has no site column and an org-only select policy, `0001_baseline.sql:591`, `:966`).

Evidence:
- `routes/approvals.ts:194-206` `notifyRole`: raw insert-select over `memberships` by `role_key`; no site filter, no preferences, no actor exclusion, no `dedupe_key`.
- `routes/approvals.ts:208-219` `notifyUser` and `approvalRouting.ts:55-66` `notifyApprovalUser`: the same function twice, byte for byte. The route file uses its own copy for the matrix path (`:493`, `:528`, `:549`, `:622`) and the shared one for the direct path (`:784-827`).
- Neither sets `actor_id`, which `notify_users` does (`0017_assignment_attribution.sql:115`), so the bell cannot show who did it for approval items.

Target: delete all three; call `notifyUsers` / `notifyRoleHolders` from `notify.ts` with `entityType: 'approval'` and a `dedupePrefix` like `approval_pending:approval:<id>:<level>`. Pass the approval's `site_id` if the entity has one (approvals have no site column today; `notify_role_holders` accepts `null` = no site filter, so the first step can pass `null` and stay equivalent apart from preferences/self-exclusion). Behaviour change (preferences start applying); intended. Effort S-M. Risk low-medium; `test/directApprovals.test.ts` asserts notifications, so update expectations.

### RF-API-25 (LOW): "who are the supervisors" role lists are hand-typed in TS and SQL

`['owner','admin','manager']` at `pmTasks.ts:158`, `:193`, `maintenanceEvents.ts:153`, `:203`; `['owner','admin','manager','hse_officer']` at `inspections.ts:214`, `:258`; SQL arrays at `0027_site_shutdown_and_transfers.sql:224` (with `hse_officer`) and `:265` (with `supervisor`). These are recipient policies, not capabilities, and they silently miss a new role. Target: name them in the shared package (`NOTIFY_ON_MAINTENANCE_REPORT`, `NOTIFY_ON_INSPECTION_REPORT`), or derive from a capability (`roles where can(role, 'pm:update')`). The SQL copies cannot import TS; at least list them side by side in one comment block in `notify.ts`. Effort S. IDEA-level for the SQL half.

## 9. Query-string parsing, filters and pagination

### RF-API-26 (LOW): every list endpoint hand-parses its query string and hand-numbers placeholders

Evidence: 26 `typeof req.query.x === 'string'` checks (compliance 7, approvals 4, assets 4, dashboard 3, spareParts 3, ...), 40 `$${values.length}` placeholder builds, `clauses.push` in 15 files. Two identical `qp()` helpers (`defects.ts:82-85`, `risks.ts:84-87`) plus a third local `add('... $?', v)` helper in `defects.ts:91` and a `Where` class in `exports.ts:64-90` that does the same `$?` substitution. The "filter by location" sub-select `site_id in (select id from public.sites where location_id = $n)` is typed 11 times across route files.

Query values are never validated, so a malformed one reaches Postgres: `?asset_id=abc` or `?dueBefore=tomorrow` raise `22P02`/`22007` and answer 500 (RF-API-13). Limits are parsed four different ways and five are unbounded: `devices.ts:114` (`|| 10`), `notifications.ts:13` (`|| 60`), `reports.ts:26` (`|| 50`), `pmTasks.ts:51` and `inspections.ts:83` (`|| 100`) take any number, including negatives (Postgres rejects `limit -1`: 500) and `limit=100000000`. Capped ones: `analytics.ts:166` (50), `escalations.ts:81` (200), `audit.ts:51` (200). Only `audit.ts:51-52` supports `offset`; every other list returns the full table (assets, work orders, defects, risks, inspections). Fine at one client's scale today; it is the first thing to break at 50k assets.

Target: `apps/api/src/http/query.ts`:

```ts
export const listQuery = <S extends z.ZodRawShape>(shape: S) =>
  z.object({ limit: z.coerce.number().int().min(1).max(500).default(100), offset: z.coerce.number().int().min(0).default(0), ...shape })
export class Where { add(sql: string, v: unknown); addIf(cond, sql, v); inLocation(col, locationId); toSql() }   // lifted from exports.ts:64-90
```

Each list route declares its filters as a zod object (`status: z.enum(WO_STATUSES).optional()`, `asset_id: z.string().uuid().optional()`) and gets typed values or a 400. Pagination can stay opt-in (default limit high enough to be equivalent today) so the app does not change. Effort M (15 files). Risk low.

## 10. Tests

Structure: `apps/api/test/` holds 11 integration files (vitest + supertest against a real Postgres, `globalSetup.ts` runs migrations, `fixtures.ts` seeds 2 orgs / 3 sites / 3 assets / 7 users with fixed UUIDs, `helpers.ts` exports `apiAs(email)` which logs in through the real `/auth/login`). `apps/api/src/*.test.ts` holds 3 pure unit files (`depreciation`, `health`, `kpis`). `vitest.config.ts` runs files sequentially (`fileParallelism: false`) because fixtures are shared. The split itself is right: unit tests for pure maths next to the code, integration tests for RLS and gates in `test/`. No duplication between the two layers.

### RF-API-27 (LOW): copy-pasted test helpers

- `withClient` (owner-pool client, connect/end) is defined four times: `test/attributionAndAudit.test.ts:14`, `test/depreciation.test.ts:15`, `test/health.test.ts:33`, `test/uatRound2.test.ts:21`.
- Unique-suffix generators four times: `uniqueSuffix` in `attributionAndAudit.test.ts:10`, `depreciation.test.ts:11`, `health.test.ts:13`; `suffix` in `assignmentNotifications.test.ts:26`.
- Asset/site factories five times with different shapes: `createAsset` (`depreciation.test.ts:27`), `createHealthTestAsset` (`health.test.ts:17`), `makeAsset`/`makeSite` (`siteShutdownAndTransfer.test.ts:21-37`), plus inline inserts elsewhere.
- `type Api = Awaited<ReturnType<typeof apiAs>>` re-declared per file (`uatRound3.test.ts:18` inlines it).
- `seedFixtures()` is called in a `beforeAll` in every file (it is idempotent per process); could be a vitest `setupFiles` entry.

Target: move `withClient`, `uniqueSuffix`, `makeSite`, `makeAsset`, `makeWorkOrder`, `Api` into `test/helpers.ts` (or `test/factories.ts`), add `setupFiles: ['./test/setup.ts']` that seeds. Effort S. Risk none.

### RF-API-28 (LOW): round-named test files

`test/uatRound2.test.ts` (F1 report gates, F4 audit wildcard, F10 depreciation preview, F13 analytics timezone, asset edit health) and `test/uatRound3.test.ts` (approval rule bands, report requester) are organised by when the bug was found, not by feature. `rbac.test.ts` similarly carries `TASK-1.1`, `TASK-1.2`, `TASK-2.6` describe names. Target: move each `describe` into a feature file (`reports.test.ts`, `rbac.test.ts`, `depreciation.test.ts`, `analytics.test.ts`, `assets.test.ts`, `approvals.test.ts`) and keep the round/task id in the test name for traceability. Effort S. Risk none.

### RF-API-29 (MEDIUM): an integration test pins the superseded health model

`test/health.test.ts:43-59` ("decay math") calls `public.recompute_asset_health($1)` directly and asserts the old linear decay (50 days of 100 = 50). Production no longer calls that SQL function: the cron uses `recomputeAllHealthScores` from `healthService.ts` (`jobs.ts:21-25`), whose header (`healthService.ts:1-25`) says the linear decay was replaced by the five-signal score; `assets.ts:499` says the same. The function is still redefined in `db/migrations/0027_site_shutdown_and_transfers.sql:284-313` and is still called by `scripts/seed-dev.mjs:266`, so a fresh dev seed scores assets with the old model until the first 01:00 cron. The threshold-crossing blocks (`health.test.ts:61-158`) test `apply_asset_health`, which is still live (called from `healthService.ts` `applyScore`), so they stay. Target: replace the "decay math" block with one that runs `recomputeAllHealthScores(ownerPool, ORG_A)` and asserts a five-signal score; switch `seed-dev.mjs` to the TS recompute (or call the API's job); then the dead-code pass can retire the SQL function. Effort M. Risk low.

### RF-API-30 (MEDIUM): depreciation maths exists twice (TS and SQL) with no cross-check

`depreciation.ts` `buildSchedule` (straight line, declining balance, SYD) drives schedules and posting; `public.recompute_asset_depreciation_for()` (`db/migrations/0022_parts_and_depreciation.sql`, method branches from about `:335`) recomputes the register's `nbv_cents` nightly and on asset edit (`assets.ts:144-147`, `org.ts:128`). `src/depreciation.test.ts` tests the TS; `test/depreciation.test.ts` tests the SQL. Nothing asserts they agree, so the register NBV and a schedule's closing value for the same asset can drift. Consolidating is a design decision (SQL is needed for the cron); the cheap refactor is one parity test that builds the same asset both ways and compares year-end values. Effort S. Risk none.

### RF-API-31 (MEDIUM): nothing runs the tests or the typechecker automatically

- `.github/workflows/deploy.yml` is the only workflow: on every push to `main` it SSHes to the VPS and runs a deploy script (`/opt/assetcore/deploy/deploy.sh`, not in the repo). No test, typecheck or lint job, and it deploys regardless.
- Root `npm run build` (`package.json`) builds app and admin only, not the API; `build:api` is separate. `apps/api/Dockerfile:1-23` copies a prebuilt `dist`, so `tsc` runs only when someone packages.
- `apps/api/tsconfig.json` has `include: ["src"]`, `exclude: ["src/**/*.test.ts"]`: no test file is ever typechecked (vitest strips types without checking). The 18 `any` in `test/assignmentNotifications.test.ts` are a symptom.
- No ESLint config anywhere, yet `app.ts:40` carries an `eslint-disable-next-line` comment.

Target: a `ci.yml` with a Postgres 16 service container running `npm ci`, `npm run build:api`, `tsc -p apps/api/tsconfig.test.json --noEmit` (a second tsconfig including `test/` and `src/**/*.test.ts`), and `npm test`; make `deploy.yml` depend on it (`needs:` or `workflow_run`). Effort M. Risk none to code. Do this early: it is what makes every other refactor here safe. (Touches CI config, which is the user's call.)

## 11. Config, env and logging

Summary: good. `config.ts` is a single zod-validated env schema, read once; no other file reads `process.env` (one comment in `maintenanceEvents.ts:39`). Logging is pino everywhere it exists (`app.ts`, `index.ts`, `jobs.ts`, `files.ts`, `auth/mailer.ts`); `console` appears only in `config.ts:32` (before the logger can exist, correct) and `auth/mailer.ts:27` (the dev-mode email print).

### RF-API-32 (LOW): small config and logging inconsistencies

- `isDev = config.NODE_ENV !== 'production'` (`config.ts:37`): `test` counts as dev, so tests run with pino-pretty and CORS on. Prefer `isProd` / `isTest` explicitly.
- `auth/mailer.ts:26-27` prints the whole email body (including invite and reset links with live tokens) to stdout whenever SMTP is unset, in production too. The link is also returned to the admin in the response, so the print adds a second copy in container logs. Gate the `console.log` on `!isProd`.
- Route handlers never log (`req.log` unused). Domain events of interest (insufficient stock on close, approval routed to nobody) leave no trace except the HTTP status. IDEA.
- `routes/health.ts:9-10` reads `package.json` by relative path at import time; `routes/admin/version.ts` does its own version read. One `version.ts` module.

### RF-API-33 (MEDIUM): the database's notion of "today" differs between exports and everything else

`routes/exports.ts:627` sets `set_config('TimeZone', config.TZ, true)` inside its transaction so `current_date` is the org's date. No other route does; `withOrgContext` (`db.ts:45-50`) sets four GUCs but not `TimeZone`. 26 `current_date` uses across 10 route files (integrity 6, dashboard 3, defects 2, risks 2, pmTasks 2, depreciation 2, analytics 2, assets 1, compliance 1) therefore use the Postgres server's zone (UTC in `deploy/docker-compose.yml`; only the API container gets `TZ`). Between 00:00 and 01:00 Lagos time the dashboard's "overdue" and the exported "overdue" disagree. Target: add `'TimeZone', config.TZ` to the `set_config` call in `withOrgContext` and delete the one in exports; or set `options: '-c timezone=...'` on both pools in `db.ts`. Behaviour change in that one-hour window (the intended one). Effort S. Risk low.

## 12. TypeScript quality

Plain language: explicit `any` is almost absent (2 in `assets.ts:425`, `:455`; 20 in tests), but that is because `pg` returns `any` rows by default. Only 2 of several hundred queries are typed (`healthService.ts:137`, `:201` use `c.query<SignalRow>`). So column typos in `rows[0].x` (103 `rows[0].` accesses) are invisible to the compiler.

### RF-API-34 (LOW): untyped query results and repeated request plumbing

- Untyped rows: introduce row types for the handful of tables read by logic, not just echoed to JSON: `ApprovalRow` (approvals already has a partial `DirectRow`, `approvals.ts:702-706`, and casts `rows[0] as DirectRow` at `:739`, `:901`), `WorkOrderRow`, `AssetRow`, `MembershipRow`. Use `c.query<T>()` where the code branches on columns (approval routing, WO transitions, stock).
- `req.claims!` non-null assertion: 202 occurrences. Every tenant route runs behind `requireAuth` + `requireOrg`, but the type does not say so. Target: `tenantCtx(req)` in `claims.ts` returning `{ userId: string; orgId: string; role: string | null; ... }` (throws if missing), or a `TenantRequest` type for handlers registered via the tenant router.
- `import('pg').PoolClient` / `import('express').Request` inline type imports: 24. Use top-level `import type`.
- `String(req.params.id)`: 21. Express 5 types `req.params` values as `string`; the `String()` wrappers are only needed where the param name is not in the path literal. Harmless; cleanup with the split.
- `files.ts:149` `req.params.filePath as unknown as string[]`: correct for Express 5 wildcard params; add a comment or a typed helper.

Effort M overall, best done per file during the RF-API-21 splits. Risk low.

## Bugs seen in passing (not chased; for OUT-OF-SCOPE.md / the security and correctness passes)

| # | What | Evidence | Severity guess |
|---|---|---|---|
| B1 | Any active member (including `viewer`) can create or overwrite integration config; `integration:manage` is enforced only in the UI | `routes/integrations.ts:32`; `apps/app/src/pages/Integrations.jsx:206` | HIGH (security) |
| B2 | Any active member can edit or soft-delete any document | `routes/documents.ts:114`, `:138`; RLS `0021_asset_master_and_documents.sql:147-148` org-only | MEDIUM (router is UI-unreachable per 05b, but the endpoint is live) |
| B3 | Every mutating request runs `requireActiveMembership` once per router it passes (up to ~28 owner-pool queries for routers mounted last) | RF-API-01 | MEDIUM (performance, pool pressure) |
| B4 | Approve / reject check "is it waiting on you" against the JWT role (up to 60 min stale), not the live membership role the cap check used | `routes/approvals.ts:508-509`, `:607` | MEDIUM |
| B5 | `PATCH /work-orders/:id` with `status` skips transition rules, stock consumption, defect resolution, `actual_end`, closing notifications, health refresh; `POST /work-orders` accepts any status including `closed` | `workOrders.ts:25`, `:112`, `:379-421`, `:355` | MEDIUM |
| B6 | Closing a WO through a maintenance completion skips parts consumption and defect resolution | `maintenanceEvents.ts:111-127` | MEDIUM |
| B7 | Defect / risk / compliance-audit refs are `count(*)+1`: concurrent creates collide on `unique (org_id, ref)` (500); for compliance audits the count is site-scoped by RLS, so a site-scoped creator collides deterministically | `defects.ts:76-80`, `risks.ts:69-72`, `compliance.ts:352-355`, `:594-596`; `0005_compliance_iso.sql:55-56` | MEDIUM |
| B8 | Two `DELETE /compliance-audits/:id` handlers; the first (no `deleted_at is null` guard) wins, so deleting an archived audit answers 204, moves `deleted_at` and writes a second audit row; the second handler never runs | `compliance.ts:207-216`, `:492-508` | LOW |
| B9 | 6 of 10 upload routes skip magic-byte content validation and the size-limit 400 | RF-API-14 table | MEDIUM (security) |
| B10 | Last-owner protection reads outside the transaction with no lock; two concurrent demotions can remove both owners | `orgMembers.ts:36-42`, `:55-63`, used at `:174-183`, `:279-282` | LOW |
| B11 | Member invite sends the email before the transaction commits; a failed commit leaves a mailed link to a user that does not exist. Invite audit row uses the user id as a membership id | `orgMembers.ts:136-152` | LOW |
| B12 | Password reset / change: password update and refresh-token revocation are separate autocommit statements | `auth/routes.ts:242-256`, `:273-282` | LOW |
| B13 | Malformed JSON, oversized bodies, a non-uuid id in a path or query, and unique/FK violations answer 500 | `app.ts:41-44`; RF-API-13 | LOW |
| B14 | Negative or huge `limit` values reach SQL unbounded | `devices.ts:114`, `notifications.ts:13`, `reports.ts:26`, `pmTasks.ts:51`, `inspections.ts:83` | LOW |
| B15 | Approval notifications ignore notification preferences, actor exclusion and site scope | RF-API-24 | LOW-MEDIUM |
| B16 | `current_date` is the DB server's zone (UTC) everywhere except exports | RF-API-33 | LOW |
| B17 | Money column headers hard-code "(NGN)" though orgs have `base_currency` since 0024 | `reportBuilders.ts:41-43`; `exports.ts:137-141`, `:188` | LOW |
| B18 | `/org/settings` changes the depreciation policy (and recomputes every asset's book value) with no audit row; `PATCH /org` also unaudited | `org.ts:65-131` | LOW (governance) |
| B19 | Platform invite on an existing email silently overwrites that user's role in the target org (`on conflict ... do update set role_key`) | `routes/admin/users.ts:83-86` | LOW (admin console, out of scope) |
| B20 | `scripts/seed-dev.mjs:266` scores dev assets with the retired linear-decay SQL | RF-API-29 | LOW (dev only) |
| B21 | Profile router's declared gate (`requireAuth` only) is not its effective gate; an orgless user is refused by the sites router first | `profile.ts:9`, `index.ts:41` | LOW |

## Top 10 refactors by value / effort

| Order | ID | What | Effort | Risk | Why here |
|---|---|---|---|---|---|
| 1 | RF-API-31 | CI: tests + `tsc` (including tests) on every push, deploy gated on it | M | none | Makes every refactor below verifiable; today a broken test deploys anyway. |
| 2 | RF-API-01 (+01b, 04) | Gate once in `routes/index.ts` (or `tenantRouter()`), delete 28 blanket `.use` lines, explicit `requireCap` on every route plus a route-table test | M | medium | Fixes the N-times membership query, makes each router's gate real; touches the top of every route file, so it must land before any file split. |
| 3 | RF-API-02 | `effectiveRole/isOwner/hasAnyCap/requireAnyCap` in `claims.ts`/`rbac.ts`; remove 5 re-implementations and the stale `req.claims!.role_key` reads | S | low | Small, removes a live correctness gap in approvals. |
| 4 | RF-API-05 (+06, 17) | `withOwnerTx` / `withOwnerClient` in `db.ts`; rewrite orgMembers and auth to use them | M | low-medium | Removes 15 manual rollbacks and the outside-transaction owner check. |
| 5 | RF-API-20 | `services/workOrders.ts` `transitionWorkOrder()` used by `/transition`, PATCH and maintenance completion | L | medium-high | Highest-value domain fix: three divergent close paths. Own session. |
| 6 | RF-API-14 | `uploadRoute()` factory in `files.ts`; all 10 upload routes get sniffing, size 400 and cleanup | M | medium | Removes ~10 copies and closes the validation gap. |
| 7 | RF-API-09 | Shared enums package (`packages/domain`) used by API zod schemas and app label maps; rename the two `DEPRECIATION_METHODS` | M | low | 10 two-way copies plus in-API retypes; prevents the next drift. |
| 8 | RF-API-24 | Approvals use `notifyUsers`/`notifyRoleHolders`; delete 3 raw inserts | S-M | low-medium | Preferences, dedupe and actor attribution for the busiest notification source. |
| 9 | RF-API-19 | Generic `ref_counters` + `nextRef()` for DEF/RSK/AUD | M | low-medium | Removes 4 copies and the site-scope collision. |
| 10 | RF-API-21 | Split approvals, workOrders, assets, exports, compliance into sub-routers and services (with RF-API-12 `send()` helper, RF-API-10 `parseOr400`, RF-API-15 `auditFromReq`, RF-API-26 `listQuery` applied per file as each is split) | L (5 x M) | low | Mechanical once 2-9 are in; each file is one session. |

Honourable mentions (S, do any time): RF-API-33 (TimeZone in `withOrgContext`), RF-API-27/28 (test helpers and file names), RF-API-30 (depreciation parity test), RF-API-22 (rename `routes/health.ts`), RF-API-13 (error middleware status mapping).

Sequencing:
- Must be first: 1 (CI) then 2 (gate). Everything else edits the same route files; doing the gate change later means conflicts in all 30 files.
- Parallel-safe after 2 lands (disjoint files): 3 (`claims.ts`, `rbac.ts`, `approvals.ts`, `documents.ts`, `orgMembers.ts` call sites only), 4 (`db.ts`, `orgMembers.ts`, `auth/routes.ts`), 6 (`files.ts` + upload handlers), 9 (migration + defects/risks/compliance ref helpers), 7 (new package + zod enum lines). Conflicts to watch: 3 and 4 both touch `orgMembers.ts` (run 3 first or same session); 6 and 9 both touch `compliance.ts` (different line ranges, merge cleanly if done one after the other).
- Sequential: 8 after 3 (both edit approvals notify/role code). 5 after 6 and 4 (shares `workOrders.ts`, `maintenanceEvents.ts`). 10 last, one file per session, each after the items that touch that file.
