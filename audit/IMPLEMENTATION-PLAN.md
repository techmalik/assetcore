# Implementation Plan — AssetCore
Generated: 2026-07-22 · From audit: audit/AUDIT-REPORT.md · Baseline: `main @ bd9138b`

## How to execute this plan

Work wave by wave, in order. One task per session for L tasks; S/M tasks may be batched within a wave. Before marking a task done, run its **Verify** step exactly. Commit per task with the task ID in the commit message (e.g. `TASK-1.1: gate sites/locations/categories APIs`). If a task's premise doesn't match the code you find (line moved, already fixed), stop and re-check against the current file before improvising — line numbers reference `bd9138b` and may drift as earlier tasks land. Migrations: this repo numbers them sequentially in `db/migrations/`; the next free number at plan time is `0006` — if it's taken, use the next free one and keep references consistent within your session. Run migrations locally with `npm run migrate`. Builds: `npm run build:app`, `npm run build:api` must pass after every task.

Repo layout: `apps/app` = React org-user frontend, `apps/admin` = platform console (not touched by this plan), `apps/api` = Express + zod + pg API, `db/migrations` = SQL, RLS-based multi-tenancy via `withOrgContext` (`apps/api/src/db.ts`) setting `app.org_id` and `app.site_ids` GUCs. Capability checks: `requireCap('entity:action')` middleware from `apps/api/src/middleware/rbac.ts`, mirrored client-side in `apps/app/src/lib/rbac.js`.

## Decisions needed before execution

1. **Asset status enum.** Current: `operational | attention | critical | offline` (`0001_baseline.sql:169`). David's demo uses `operational | maintenance | standby | offline`, letting health bands carry severity while status carries operational state. **Recommendation: adopt David's model** — add `maintenance` and `standby`, keep `attention`/`critical` valid in the DB for old rows but remove them from UI pickers and map them in badges (`attention`→amber, `critical`→red) until data is migrated. TASK-4.2 is BLOCKED on this.
2. **What resets health to 100%.** **Recommendation (encoded in EPIC-1): an explicit "Complete maintenance" action** with its own capability, usable from a PM task, a work order, or standalone — NOT automatic on WO closure (WOs close for many non-maintenance reasons). PM-task completion continues to reset (it is an explicit maintenance completion already).
3. **Global location switcher** (topbar control filtering every page, à la David). **Recommendation: yes** — EPIC-2, Wave 4. Skip it only if you want to ship Waves 1–3 faster.
4. **Live tracking / map page** (Wave 6 IDEA). Owner call — promote or leave deferred.

---

## Wave 1 — Critical: security & data integrity

### TASK-1.1: Gate location/site/category write APIs behind a new `org:manage` capability
- **Severity**: CRITICAL
- **Category**: security
- **Effort**: M
- **Depends on**: none
- **Files**: `apps/api/src/middleware/rbac.ts`, `apps/app/src/lib/rbac.js`, `apps/api/src/routes/sites.ts`, `apps/api/src/routes/locations.ts`, `apps/api/src/routes/categories.ts`, `apps/app/src/App.jsx`, `apps/app/src/components/Sidebar.jsx`, `apps/app/src/pages/Admin.jsx`

**Problem**: The three routers register only `requireAuth, requireOrg, requireActiveMembership` (`sites.ts:12`, `locations.ts:12`, `categories.ts:12`) with **no capability gate on any write route**. Every other write router gates (e.g. `assets.ts:127` uses `requireCap('asset:update')`). Result: any active member — including the read-only `auditor` and `viewer` roles — can POST/PATCH/DELETE sites, locations, and categories via the API. Additionally the Admin page UI gate uses `can(roleKey,'audit:read')` (`App.jsx:96`, `Sidebar.jsx:37`), which admits `auditor` into the whole Admin surface.

**Fix**:
1. In `apps/api/src/middleware/rbac.ts`, add capability `org:manage` to the role→caps map for `owner` and `ops_manager` only. Mirror the same addition in `apps/app/src/lib/rbac.js` (the two maps must stay identical — compare them line by line after editing).
2. In `sites.ts`, `locations.ts`, `categories.ts`: leave GET routes as-is; add `requireCap('org:manage')` as route-level middleware on every POST/PATCH/DELETE route (follow the exact pattern used in `assets.ts:127`).
3. Do NOT add `org:manage` to `GRANTABLE_CAPS` in `orgMembers.ts:24-31` — hierarchy management must stay role-bound, not grantable.
4. Frontend: in `Admin.jsx`, hide create/edit/archive buttons on the Locations and Sites tabs unless `can(roleKey,'org:manage')`. Change the Admin page/nav gate (`App.jsx:96`, `Sidebar.jsx:37`) from `audit:read` to: show Admin if the user has `org:manage` OR `user:manage` OR `audit:read`, but inside `Admin.jsx` render only the tabs the user's caps allow (Team → `user:manage`; Locations/Sites/Configuration → `org:manage`; Audit tab → `audit:read`). Auditor then sees only the Audit tab.

**Must not break**: `owner` and `ops_manager` flows through Onboarding (`Onboarding.jsx` creates sites) must still work — check whether onboarding runs through these routes and, if the creating user is always `owner`, no change is needed.

**Verify**: Write/run a manual check: authenticate as a `viewer`-role member (seed via `npm run seed:dev` or invite flow), call `POST /api/sites` with a valid body → expect 403. As `ops_manager` → expect 201. As `auditor`, open `/admin` in the app → only the Audit tab renders.

### TASK-1.2: Fix `compliance_audits` RLS so site-scoped users cannot write out-of-scope audits
- **Severity**: CRITICAL
- **Category**: security
- **Effort**: S
- **Depends on**: none
- **Files**: new migration `db/migrations/0006_security_fixes.sql`

**Problem**: In `0005_compliance_iso.sql:56-61`, the SELECT policy on `compliance_audits` applies the site-scope predicate (`current_site_ids() is null or site_id = any(current_site_ids())`), but INSERT checks only `org_id = current_org_id()` and UPDATE has no `with check` clause at all. A site-scoped user can create or edit audits for sites outside their scope.

**Fix**: In the new migration, `drop policy` and recreate the INSERT and UPDATE policies on `public.compliance_audits` so that BOTH `using` and `with check` include the same predicate the SELECT policy uses: `org_id = current_org_id() and (site_id is null or current_site_ids() is null or site_id = any(current_site_ids()))`. Copy the exact predicate style from the asset policies in `0004_locations_rbac.sql:84-125`. Keep the DELETE policy consistent too if one exists.

**Must not break**: All-scope users (`current_site_ids()` null) must still be able to write audits with `site_id is null` (org-wide audits).

**Verify**: `npm run migrate` applies cleanly. In psql with the app role: `set app.org_id=...; set app.site_ids='{<siteA>}';` then `insert into compliance_audits(org_id, site_id, ...) values (current_org, <siteB>, ...)` → expect RLS violation; with `site_id = <siteA>` → succeeds.

### TASK-1.3: Stop accepting client-supplied `photos`/`documents` arrays; validate uploads server-side
- **Severity**: CRITICAL
- **Category**: security
- **Effort**: M
- **Depends on**: none
- **Files**: `apps/api/src/routes/assets.ts`, `apps/api/src/files.ts`, `apps/app/src/pages/Assets.jsx`

**Problem**: `ALLOWED` (`assets.ts:21-25`) includes `'photos'` and `'documents'`, and `assetInput` types them as `z.array(z.unknown())` (`assets.ts:55,59`). A client can PATCH arbitrary arrays — bypassing the upload endpoints (`POST /assets/:id/photos` at `:250-264`, `POST /assets/:id/documents` at `:269-281`), the MAX_PHOTOS=5 cap, and file-type expectations, and can plant arbitrary URLs that other users' browsers will load.

**Fix**:
1. Remove `'photos'` and `'documents'` from `ALLOWED` and from `assetInput` in `assets.ts`. Photos/documents may then ONLY change via the dedicated upload/remove endpoints.
2. Check `Assets.jsx` for any code path that sends `photos`/`documents` in create/update payloads (the create flow uploads `pendingPhotos` after insert — keep that; it uses the upload endpoint). Remove any direct field writes.
3. In the upload endpoints (and `files.ts` helper if shared): validate MIME type from the uploaded buffer, not just filename — photos: accept only `image/jpeg`, `image/png`, `image/webp`, max 10 MB each; documents: accept `application/pdf`, common office types, images, max 25 MB each, max 10 files per request. Reject others with 400 `{error:'unsupported_type'}`.
4. Add a remove-photo endpoint if one doesn't exist (`DELETE /assets/:id/photos/:index` or by stored filename), mirroring the documents-remove pattern; wire the UI delete buttons to it.

**Must not break**: Existing stored `photos`/`documents` JSON must keep rendering; CSV import (`assets.ts:152-227`) does not touch photos and must be unaffected; the 5-photo cap (`:255-264`) stays enforced.

**Verify**: `PATCH /api/assets/:id` with `{"photos":[{"url":"https://evil.example/x.png"}]}` → photos unchanged in response. Upload a `.txt` renamed to `.png` to `/photos` → 400. Upload a real PNG → 200 and appears in the asset.

### TASK-1.4: Authorize file downloads and asset activity against the caller's site scope
- **Severity**: CRITICAL
- **Category**: security
- **Effort**: M
- **Depends on**: none
- **Files**: `apps/api/src/files.ts`, `apps/api/src/routes/assets.ts` (activity endpoint `:85-108`), any file-serving route

**Problem**: RLS site-scoping applies to parent tables (assets, WOs, inspections — `0004_locations_rbac.sql:84-125`) but file serving and activity feeds authorize by org only. A site-scoped user who obtains a file path or asset id for another site can fetch its files/activity directly, bypassing the list-level scoping.

**Fix**:
1. Locate the file-download route (in `files.ts` / `routes/index.ts`). Before streaming a file, resolve the owning entity (asset/WO/inspection/licence) from the stored path convention and run the lookup **through `withOrgContext`** so RLS applies — if the parent row is invisible to the caller, return 404. If path→entity resolution isn't feasible for all buckets, add a `file_registry` check or at minimum enforce it for `asset-photos`, `asset-documents`, `attachments`, `inspection-reports`, `pm-reports`, `compliance-documents` buckets by parsing the entity id embedded in the stored path.
2. `GET /assets/:id/activity` (`assets.ts:85-108`): confirm the initial asset fetch goes through `withOrgContext` (RLS will 404 out-of-scope assets). If the activity query unions `audit_log` (org-scoped table), gate the whole endpoint on the asset row being visible first — return 404 before querying activity when the asset lookup returns no row.

**Must not break**: All-scope users see everything as before; `AuthImage.jsx` (frontend authenticated image loader) keeps working.

**Verify**: As a user scoped to site A, request `GET /api/assets/<asset-in-site-B>/activity` → 404. Request a site-B asset photo URL → 404. Same requests as an unscoped `ops_manager` → 200.

### TASK-1.5: Resolve dependency advisories and pin patched versions
- **Severity**: CRITICAL
- **Category**: security
- **Effort**: S
- **Depends on**: none
- **Files**: `apps/api/package.json`, `package-lock.json`

**Problem**: `apps/api/package.json:24-26` pins `multer ^1.4.5-lts.1`, `node-cron ^3.0.3`, `nodemailer ^6.9.16`. At least nodemailer has had post-6.9.x security advisories; multer 1.x is EOL (2.x is the maintained line). No audit gate exists.

**Fix**: 1) Run `npm audit --omit=dev` at the repo root and in `apps/api`. 2) Upgrade `nodemailer` to the latest non-breaking major that clears the advisory (check its changelog; if 7.x is required, adjust the `createTransport` usage in `apps/api/src/auth/mailer.ts` per its migration notes). 3) Upgrade `multer` to `^2.x` — API is compatible for the `upload.single/array` usage here, but confirm each `uploadTo(...)` call site still compiles. 4) Upgrade `node-cron` to latest 3.x/4.x. 5) Document any残 transitive advisory that has no fix in a comment in `package.json` — do not suppress silently.

**Must not break**: File uploads (all buckets) and the three cron jobs (`jobs.ts:11-14`) must run after the upgrade.

**Verify**: `npm audit --omit=dev` reports no high/critical advisories with available fixes; `npm run build:api` passes; upload a photo and run `POST /api/compliance/check-expiry` successfully.

---

## Wave 2 — High: broken/incomplete workflows & bugs

### TASK-2.1: Centralize health changes; fix the decay dead zone; trigger crossings on manual edits
- **Severity**: HIGH
- **Category**: backend
- **Effort**: L
- **Depends on**: none
- **Files**: new migration `db/migrations/0006_health_fixes.sql` (or next free number), `apps/api/src/routes/assets.ts`, `apps/api/src/routes/pmTasks.ts`

**Problem** (three defects, one root cause — health mutations are scattered):
a) Decay job `recompute_asset_health()` filters `where next_maintenance_at > last_maintenance_at` (`0003_health_lifecycle.sql:41`). PM completion sets `next_maintenance_at = coalesce(schedule.next_due, current_date+90)` (`pmTasks.ts:80-88`); when `next_due` is today/past, the asset is skipped by the job forever and health pins at 100.
b) Manual `health_score` edits via asset POST/PATCH (`assets.ts` ALLOWED) write directly — the 50% inspection trigger and 30% notification/auto-WO logic (`0003:51-102`) run only inside the daily cron, so a manual drop to 25% produces no reaction until 01:00.
c) The crossing logic can't be reused because it's inlined in the recompute function.

**Fix**:
1. In the new migration, create `public.apply_asset_health(p_asset_id uuid, p_new_health int, p_actor uuid default null)` — a SQL/plpgsql function that: reads the current health; updates the asset; and on downward crossing of the org's inspection threshold (`coalesce((o.settings->'health'->>'inspectionThreshold')::int, 50)` — copy from `0003:35`) or of 30, performs the same notification/asset_activity/auto-WO inserts that `recompute_asset_health()` does at `0003:51-102`. Move that logic INTO this function and have `recompute_asset_health()` call it per asset (compute the decayed value, then call `apply_asset_health`). Keep the auto-WO dedup guard (`title like 'Auto:%'`, open corrective WO check, `0003:83-102`).
2. Fix the dead zone: in the reset path (`pmTasks.ts:80-88` and later EPIC-1), when the computed `next_maintenance_at <= current_date`, set it to `current_date + 90` (the existing fallback) so decay always has a forward-looking window. In the same migration, backfill existing bad rows: `update assets set next_maintenance_at = current_date + 90 where next_maintenance_at is not null and last_maintenance_at is not null and next_maintenance_at <= last_maintenance_at`.
3. In `assets.ts` POST and PATCH: when the payload includes `health_score`, after the row write, call `select public.apply_asset_health(id, new_value, actor)` instead of relying on the column update alone (simplest: strip `health_score` from the generic column update and route it through the function).

**Must not break**: The 01:00 cron (`jobs.ts:13`) keeps working; the once-per-crossing semantics (no notification spam on repeated saves at the same value — the crossing check `old > threshold AND new <= threshold` provides this) must hold; CSV import sets initial health without firing triggers for values ≥ threshold.

**Verify**: `npm run migrate`. Manually PATCH an asset from health 80 → 25: expect within the same request cycle a `maintenance_due` notification row, an `inspection_due` notification row, and one new `Auto:` corrective work order. PATCH 25 → 20: no duplicate WO. Set an asset's `next_maintenance_at` to yesterday, run `select recompute_asset_health()`: the asset is not skipped and decays.

### TASK-2.2: Create a real inspection record when health crosses the inspection threshold
- **Severity**: HIGH
- **Category**: workflow
- **Effort**: M
- **Depends on**: TASK-2.1
- **Files**: migration from TASK-2.1 (extend `apply_asset_health`), `apps/app/src/pages/Inspections.jsx`

**Problem**: The 50% trigger (`0003:51-70`) only inserts notifications and an `asset_activity` alert — nothing is written to `public.inspections`, so the Inspections page shows no actionable item ("trigger an inspection" requirement unmet; decision #1 in the audit assumed record + notify).

**Fix**:
1. Inside `apply_asset_health` (from TASK-2.1), on downward crossing of the inspection threshold, additionally insert into `public.inspections` a row: `kind='condition'`, `status='due'`, `title`/`notes` = `'Auto: health at <n>% — condition inspection required'`, `asset_id`, `site_id` copied from the asset, `due_date = current_date + 7`. Use the inspections table columns from `0001_baseline.sql:539-557` — check the exact column list before writing the insert.
2. Dedup guard: skip the insert if an open (`status in ('scheduled','due','in_progress')`) inspection with `title like 'Auto:%'` already exists for the asset — mirror the auto-WO guard pattern (`0003:83-88`).
3. In `Inspections.jsx`, no structural change needed (the new row appears in the list); just confirm `due` status renders with the amber badge.

**Must not break**: Manually created inspections unaffected; the notification insert stays (record AND notify).

**Verify**: Drop an asset's health across the threshold (via TASK-2.1's path): one new inspection with status `due` appears in `/inspections`; repeat the crossing → still exactly one open `Auto:` inspection for that asset.

## EPIC-1: Explicit maintenance-completion flow (replaces "nothing resets health except PM tasks")
- **Verdict source**: audit H1 — WO closure never resets health (`workOrders.ts:156-193`); the 30% auto-WO loop cannot restore the asset. Patching WO-close to auto-reset was rejected (WOs close for non-maintenance reasons); an explicit completion event is the correct model.
- **Target design**: a `maintenance_events` table (org, site, asset, optional `pm_task_id`, optional `work_order_id`, `completed_at date`, `next_maintenance_at date` (must be > completed_at), `notes`, `report` file, `performed_by`). A new grantable capability `maintenance:complete` (default: owner, ops_manager, maint_engineer). Completing maintenance: inserts the event, marks the linked PM task completed / linked WO closed, resets health to 100 via `apply_asset_health`, updates the asset's last/next maintenance dates, writes `asset_activity` + `audit_log`. UI entry points: asset detail panel ("Complete Maintenance" button), WO detail (for corrective/auto WOs), Maintenance page rows.
- **Migration strategy**: expand (new table + endpoints + UI) → existing PM-completion path refactored to call the same function → no old system to delete (PM path remains, now delegating).
- **Rollback point**: through TASK-E1.2 the app behaves exactly as before (new endpoints unused).
- **Tasks**: TASK-E1.1 → E1.4

### TASK-E1.1: Migration — `maintenance_events` table + `maintenance:complete` capability
- **Severity**: HIGH · **Category**: backend · **Effort**: M · **Depends on**: TASK-2.1
- **Files**: new migration `db/migrations/0007_maintenance_events.sql`, `apps/api/src/middleware/rbac.ts`, `apps/app/src/lib/rbac.js`, `apps/api/src/routes/orgMembers.ts`

**Problem/Fix**: Create `public.maintenance_events` with columns per the epic target design plus `org_id`, `created_at`; RLS policies copied from the asset-policy pattern in `0004:84-125` (org + site scope on select AND insert `with check`). Constraint: `check (next_maintenance_at > completed_at)`. Add `maintenance:complete` to both rbac maps (owner/ops_manager/maint_engineer) and to `GRANTABLE_CAPS` (`orgMembers.ts:24-31`) with label "Complete maintenance".

**Verify**: migration applies; `select * from maintenance_events` respects site scoping in psql GUC tests (as in TASK-1.2's verify).

### TASK-E1.2: API — completion endpoints
- **Severity**: HIGH · **Category**: backend · **Effort**: L · **Depends on**: TASK-E1.1
- **Files**: new `apps/api/src/routes/maintenanceEvents.ts`, `apps/api/src/routes/index.ts`, `apps/api/src/routes/pmTasks.ts`

**Problem/Fix**:
1. `POST /assets/:id/maintenance-completions` — multipart (reuse the `uploadTo` pattern from `workOrders.ts:195-209`); body: `source` (`pm_task`|`work_order`|`manual`), optional `pm_task_id`/`work_order_id`, `completed_at` (required, not future), `next_maintenance_at` (required, > completed_at), `notes`. Gate with `requireCap('maintenance:complete')`. In one transaction through `withOrgContext`: insert the event; if `pm_task_id` → set that task `completed` (reuse the logic at `pmTasks.ts:58-88`); if `work_order_id` → transition it to `closed` with an activity entry; update asset `last_maintenance_at`/`next_maintenance_at`; call `apply_asset_health(asset_id, 100, actor)`; write `audit_log`.
2. `POST /maintenance-completions/:id/report` — upload/replace the single report file (mirror `pmTasks.ts:105-123`).
3. `GET /assets/:id/maintenance-completions` — list for the asset detail timeline.
4. Refactor the existing PM completion reset block (`pmTasks.ts:80-88`) to delegate: completing a PM task through the old endpoint now ALSO inserts a `maintenance_events` row (source `pm_task`) and routes the health reset through `apply_asset_health` — one code path for resets.

**Must not break**: existing PM completion UI (`Maintenance.jsx:317-347`) keeps working unchanged against the old endpoint.

**Verify**: complete via the new endpoint with a linked auto-WO: WO becomes `closed`, asset health = 100, `last/next_maintenance_at` updated, event row exists, notification/audit entries written. Attempt with `next_maintenance_at <= completed_at` → 400.

### TASK-E1.3: UI — Complete Maintenance modal + entry points
- **Severity**: HIGH · **Category**: frontend · **Effort**: L · **Depends on**: TASK-E1.2
- **Files**: `apps/app/src/pages/Assets.jsx`, `apps/app/src/pages/WorkOrders.jsx`, `apps/app/src/pages/Maintenance.jsx`, `apps/app/src/lib/db/` (new client module)

**Problem/Fix**: Build one shared `CompleteMaintenanceModal` (date, next-maintenance date, notes, report file input) following the existing modal style in `Assets.jsx` (`AssetModal`/`RaiseWOModal` patterns). Entry points, each visible only when `can(roleKey,'maintenance:complete')`: (a) asset detail panel next to "Raise Work Order" (`Assets.jsx:688` area) — source `manual`; (b) WO detail for non-closed corrective/emergency WOs — source `work_order` prefilled; (c) Maintenance page PM rows keep their existing completion modal (unchanged). After success, refresh the panel so the health ring shows 100 and the event appears in the activity feed.

**Verify**: `npm run build:app`; in the app, complete maintenance from an asset at 25% health → ring shows 100%, activity feed gains the completion with the actor's name, linked WO (if chosen) shows closed.

### TASK-E1.4: Show maintenance completions in the asset activity timeline
- **Severity**: MEDIUM · **Category**: frontend · **Effort**: S · **Depends on**: TASK-E1.3
- **Files**: `apps/api/src/routes/assets.ts` (activity endpoint `:85-108`), `apps/app/src/pages/Assets.jsx`

**Problem/Fix**: Extend the activity UNION (`assets.ts:85-108`) with `maintenance_events` (actor name via `users` join, label "Maintenance completed", link to report file when present). Render in the existing feed (`Assets.jsx:656-680`) with a distinct icon/color.

**Verify**: an asset with a completion shows it in the timeline with performer name and a working report link.

### TASK-2.3: Dashboard health donut must bucket by health bands, not status
- **Severity**: HIGH
- **Category**: frontend
- **Effort**: M
- **Depends on**: none
- **Files**: `apps/api/src/routes/dashboard.ts`, `apps/app/src/pages/Dashboard.jsx`, `apps/app/src/lib/health.js`

**Problem**: `dashboard.ts:20-32` buckets assets by the manually-set `status` enum and `Dashboard.jsx:200-228` colors the "Network health overview" donut from those counts. The daily decay updates `health_score` but never `status`, so an asset at 20% health renders green. The spec bands (`>50` green, `31–50` amber, `≤30` red) already exist in `apps/app/src/lib/health.js:10-19`.

**Fix**: 1) In `dashboard.ts`, add health-band counts: `good` (`health_score > 50` or null→treat null as good), `attention` (`31–50`), `critical` (`<= 30`), plus `offline` from status. 2) Point the donut and its legend at the new band counts; keep labels "Good / Attention / Critical / Offline". 3) Keep separate status-based counts for any card that is genuinely about operational state (e.g. an "Operational" KPI may stay status-based). 4) Ensure every health color in Dashboard comes from `health.js` helpers, not inline thresholds.

**Must not break**: KPI card counts that users already rely on (Total Assets, Open WOs) unchanged.

**Verify**: seed an asset with `status='operational', health_score=20` → donut counts it red/critical; `grep -rn "health" apps/app/src/pages/Dashboard.jsx` shows no hardcoded 40/70-style thresholds.

### TASK-2.4: Finish dashboard drill-down — URL filters everywhere, clickable donut & alerts
- **Severity**: HIGH
- **Category**: frontend
- **Effort**: L
- **Depends on**: TASK-2.3
- **Files**: `apps/app/src/pages/Dashboard.jsx`, `apps/app/src/pages/WorkOrders.jsx`, `apps/app/src/pages/Maintenance.jsx`, `apps/app/src/pages/Compliance.jsx`

**Problem**: Only 2 of 7 dashboard aggregates drill down filtered. Open WOs card navigates to `/work-orders` unfiltered (`Dashboard.jsx:161`; `WorkOrders.jsx:298` hardcodes `filterStatus='all'`, no `useSearchParams`). Overdue PM → `/maintenance` unfiltered (`Maintenance.jsx:101`). Compliance Alerts → `/compliance` unfiltered (`Compliance.jsx:410,418`). Donut segments (`Dashboard.jsx:200-213,230-238`) and Active Alerts rows (`:263-270`) are non-interactive. Footer links use `window.location.assign` full reloads (`:285,:336`).

**Fix**:
1. Copy the exact pattern from `Assets.jsx:718-719` (`useSearchParams` seeding initial filter state) into: `WorkOrders.jsx` (`?status=open|pending|completed…` → seed `filterStatus`), `Maintenance.jsx` (`?filter=overdue` → after load, filter task list to `status='overdue'` and select the PM tab), `Compliance.jsx` (`?filter=expiring|expired` → seed the status filter at `:418`).
2. Dashboard: Open WOs card → `nav('/work-orders?status=open')`; Overdue PM → `nav('/maintenance?filter=overdue')`; Compliance Alerts → `nav('/compliance?filter=expiring')`.
3. Make each donut segment/legend row clickable → `nav('/assets?health=good|attention|critical')` and add `health` param support to `Assets.jsx` (client-side filter on `health_score` bands alongside the existing status filter). Add `role="button"`, `tabIndex=0`, Enter/Space key handling — same a11y pattern as the KPI cards at `Dashboard.jsx:143`.
4. Alert rows: overdue-PM alerts → `/maintenance?filter=overdue`; licence alerts → `/compliance?filter=expiring`; WO alerts → `/work-orders?status=open`.
5. Replace both `window.location.assign` calls with the `nav()` helper already used by the cards.

**Must not break**: visiting the three pages with no query params behaves exactly as today.

**Verify**: click every dashboard aggregate; each lands on a list already narrowed to the matching records; browser back returns to the dashboard without a full reload.

### TASK-2.5: Fix the inspection-threshold save (RLS/capability mismatch)
- **Severity**: HIGH
- **Category**: workflow
- **Effort**: S
- **Depends on**: none
- **Files**: `apps/api/src/routes/org.ts`, `apps/app/src/pages/Admin.jsx`

**Problem**: The Configuration tab enables the threshold field for `can(roleKey,'org:manage')` (`Admin.jsx:820-871`), but `PATCH /org` writes through RLS policy `org_update` which is owner-only (`0001_baseline.sql:889`) — an `ops_manager` gets a silent failure/403 on save.

**Fix**: Add a dedicated `PATCH /org/settings` route in `org.ts` gated by `requireCap('org:manage')` (cap added in TASK-1.1) that updates ONLY the `settings` jsonb (merge, not replace: `settings = organizations.settings || $1`), executed via the owner/elevated pool (same mechanism `jobs.ts` uses to call SQL functions) with an explicit `where id = current org` check from claims. Point the Configuration tab's save at the new endpoint. Leave `PATCH /org` (name/branding) owner-only as is.

**Must not break**: owner can still rename the org; settings keys other than the one being saved survive (merge semantics).

**Verify**: as `ops_manager`, change the threshold to 40 and save → 200; `select settings from organizations` shows `{"health":{"inspectionThreshold":40}}` merged; as `viewer` → 403.

### TASK-2.6: Resolve role, grants, and site scope per-request (immediate revocation)
- **Severity**: HIGH
- **Category**: security
- **Effort**: L
- **Depends on**: none
- **Files**: `apps/api/src/middleware/requireActiveMembership.ts`, `apps/api/src/middleware/rbac.ts`, `apps/api/src/db.ts`, `apps/api/src/auth/routes.ts`, `apps/api/src/claims.ts`

**Problem**: Role, `extra_caps`, and the flattened site-id array are baked into the JWT at login (`auth/routes.ts:61-76`); `can()` reads caps from claims (`rbac.ts:45-46`). Consequence: granting/revoking a capability, changing scope, or disabling a member takes effect only at next token refresh — a revoked user keeps full access until expiry.

**Fix**:
1. In `requireActiveMembership` (already queries the membership row per request — confirm), load `role_key`, `extra_caps`, `site_scope`, `location_scope`, `status` fresh from `memberships` and attach to `req` (e.g. `req.membership`). Return 403 when status ≠ active.
2. Change `requireCap`/`can` on the API side to read from `req.membership`, not JWT claims.
3. Recompute the effective site-id array per request using the same union logic as `resolveSiteIds` (`auth/routes.ts:61-76` — extract it into a shared helper) and pass it to `withOrgContext` so the `app.site_ids` GUC reflects current scope. Keep the `NO_SITE` empty-scope sentinel behavior (`auth/routes.ts:29,75`).
4. Add a 30-second in-memory cache keyed by membership id to avoid an extra query on every request burst (simple Map with timestamps — this is a single-process API).
5. Keep the JWT claims for identity (`sub`, org) only; stop trusting its caps/site_ids (leave them in the token for backward compat this release, but unused).

**Must not break**: login/refresh flow unchanged for clients; the frontend's `rbac.js` UI gating still reads role from its session payload — after a role change the UI may lag until refresh, but the API must enforce immediately (that is the security boundary).

**Verify**: grant `pm:update` to a field_tech, and WITHOUT re-login have them PATCH a PM task → 200 within ~30s. Disable the member → their next API call 403s. Add a supertest covering both once TASK-3.1 lands.

### TASK-2.7: Harden notification generation — catch-up windows, dedup key, scoped recipients, preferences
- **Severity**: HIGH
- **Category**: backend
- **Effort**: L
- **Depends on**: TASK-2.1
- **Files**: new migration (next free number), `db` functions from `0001_baseline.sql:609-655` and `apply_asset_health`, `apps/api/src/routes/notifications.ts`

**Problem**: (a) `check_licence_expiry()` fires only when days-to-expiry is EXACTLY 90/30/7 (`0001:631`) — one missed cron day and the alert never fires. (b) Recipients are hardcoded to owner/ops_manager (`0001:627`): site-scoped staff responsible for a licence never hear about it, while out-of-scope managers of other sites do. (c) All SQL-generated notifications ignore each user's `notification_preferences` (UI at `Notifications.jsx:51-61`). (d) Dedup relies on a same-day existence check; there is no stable dedup key.

**Fix**:
1. Migration: add `dedupe_key text` to `notifications` with a partial unique index `(org_id, dedupe_key)` where not null.
2. Rewrite `check_licence_expiry()`: window semantics — for each licence and each milestone (90/30/7), if `expiry_date - current_date <= milestone` AND no notification exists with `dedupe_key = 'licence_expiry:'||licence_id||':'||milestone`, insert one (`on conflict do nothing`). A missed day then catches up on the next run.
3. Recipient selection (licence + health notifications in `apply_asset_health`): target members whose effective scope includes the record's `site_id` (site_scope/location_scope arrays or null=all — express as SQL over `memberships`), filtered to roles that hold the relevant capability, AND whose `notification_preferences` allow in-app notifications of that type (inspect the actual preference JSON shape saved by `notifications.ts` before writing the filter; default to "allow" when unset).
4. Give health/auto-WO notifications dedup keys too: `'health30:'||asset_id||':'||date` pattern is wrong (re-fires daily) — key on the crossing episode: `'health30:'||asset_id||':'||<count of completions>`, or simpler: no key but keep the existing crossing guard, and add key only to licence notifications. Choose the simpler correct option and note it in the migration comment.

**Must not break**: existing unread notifications keep rendering; the manual "Check Expiry Alerts" button (`Compliance.jsx:471` → `compliance.ts:266-271`) still works and cannot double-insert (the unique index guarantees this).

**Verify**: set a licence expiry 85 days out with no prior notifications; run check-expiry → exactly one "90" milestone notification; run again → still one. A member scoped to a different site does NOT receive it; the licence's site staff with compliance caps do.

---

## Wave 3 — Medium: hardening, metrics, tests

### TASK-3.1: Stand up the test harness + RBAC/scoping integration tests
- **Severity**: MEDIUM · **Category**: backend · **Effort**: L · **Depends on**: Wave 1 complete
- **Files**: `apps/api/package.json`, new `apps/api/test/` directory, root `package.json` (test script), optionally `docker-compose` for a disposable Postgres

**Problem**: Zero automated tests exist; the riskiest logic (RLS scoping, capability gates, health triggers) is verified only manually.

**Fix**: 1) Add `vitest` + `supertest` to `apps/api` devDependencies; `npm test -w @assetcore/api` script. 2) Test bootstrap: point at a disposable Postgres (env `TEST_DATABASE_URL`; document `docker run postgres:16` in the test README), run `scripts/migrate.mjs` against it, seed two orgs / two sites / one member per role via SQL fixtures. 3) Write the first suite covering: tenant isolation (org A cannot read org B's assets), site scoping (scoped tech gets only their site's assets from `GET /assets`), TASK-1.1 gates (viewer POST /sites → 403), TASK-1.2 policy (scoped audit insert), TASK-2.6 revocation. Keep each test independent (fresh transaction or truncate between tests).

**Verify**: `npm test -w @assetcore/api` runs green locally and documents the Postgres prerequisite; deliberately breaking a gate (comment out one `requireCap`) turns the suite red.

### TASK-3.2: Health lifecycle test suite
- **Severity**: MEDIUM · **Category**: backend · **Effort**: M · **Depends on**: TASK-3.1, TASK-2.1, EPIC-1
- **Files**: `apps/api/test/health.test.ts`

**Problem/Fix**: Cover with supertest + direct SQL assertions: decay math over a known date window (insert last=100 days span, run `recompute_asset_health()`, assert linear value); threshold crossing creates exactly one inspection + notifications (TASK-2.2); 30% crossing drafts exactly one `Auto:` WO; maintenance completion resets to 100 and restarts decay; dead-zone rows are not skipped; manual PATCH crossing fires triggers synchronously.

**Verify**: suite green; each scenario asserts row COUNTS (=1), not just existence, to catch dedup regressions.

### TASK-3.3: Unify work-order reference generation
- **Severity**: MEDIUM · **Category**: backend · **Effort**: S · **Depends on**: none
- **Files**: new migration (next free number), `apps/api/src/routes/workOrders.ts`

**Problem**: Two independent `WO-{year}-{seq}` counters — SQL auto-draft (`0003:88-91`, org-scoped count) and API `generateWoRef` (`workOrders.ts:102-108`, RLS-scoped count) — can race to the same ref; the unique constraint saves data but surfaces as a user-facing 500.

**Fix**: Create one SQL function `next_wo_ref(p_org uuid)` using a per-org counter row (`insert … on conflict … do update set n = n+1 returning`) or an advisory-locked max query; call it from BOTH the auto-draft block and `workOrders.ts` create (replace `generateWoRef`).

**Verify**: create 20 WOs concurrently (`Promise.all` in a script/test) → zero failures, 20 distinct refs.

### TASK-3.4: Upload lifecycle hygiene — orphan cleanup + audit logging
- **Severity**: MEDIUM · **Category**: backend · **Effort**: M · **Depends on**: TASK-1.3
- **Files**: `apps/api/src/files.ts`, upload endpoints in `assets.ts`, `workOrders.ts`, `inspections.ts`, `pmTasks.ts`, `compliance.ts`

**Problem**: Upload endpoints write the file to disk, then update the DB; a DB failure orphans the file. Uploads/removals are not consistently written to `audit_log`.

**Fix**: In each upload endpoint: wrap the DB write; on failure, `fs.unlink` the just-written file (best-effort, log on failure). Add `writeAuditLog` calls (`action: '<entity>.attachment.add' / '.remove'`) with the filename in `after` — copy the call style from `assets.ts:82`. Batch all endpoints in this one task.

**Verify**: force a DB error (temporarily bad column) on one endpoint in dev → uploaded file is removed from disk; audit_log rows appear for a normal upload and a removal.

### TASK-3.5: Computed PM-compliance metric + audit↔asset linkage
- **Severity**: MEDIUM · **Category**: feature · **Effort**: L · **Depends on**: none
- **Files**: `apps/api/src/routes/compliance.ts`, `apps/api/src/routes/dashboard.ts`, `apps/app/src/pages/Compliance.jsx`, `apps/app/src/pages/Dashboard.jsx`

**Problem**: "Did you comply with routine maintenance?" is a self-reported boolean (`0005:37`, `Compliance.jsx:307-310`) with no objective figure anywhere; and the audit form omits the existing `asset_id` column (`compliance.ts:156`) so audits can't reference an asset.

**Fix**: 1) `GET /compliance/pm-compliance?from&to` in `compliance.ts`: over `pm_tasks` in range, return `{total, completed, onTime, rate}` where onTime = `completed_at <= due_date`; optional `site_id` filter (RLS applies scope anyway). 2) Compliance page: a stat card "PM compliance (12 mo): N% on-time" above the audits panel, next to the Yes/No attestation so the subjective answer sits beside the objective number. 3) Dashboard: add the same rate to the KPI row or health card. 4) AuditModal: add an optional asset select (assets list already available via `listAssets`) writing `asset_id`.

**Must not break**: existing audits without asset_id render unchanged.

**Verify**: seed 4 PM tasks (2 on-time completed, 1 late, 1 overdue-open) → endpoint returns total 4, completed 3, onTime 2, rate 50%; UI card shows it.

### TASK-3.6: Fix stale migration hints and unguided error states in Compliance
- **Severity**: MEDIUM · **Category**: frontend · **Effort**: S · **Depends on**: none
- **Files**: `apps/app/src/pages/Compliance.jsx`

**Problem**: Load-failure copy says "Run migration 0004_phase3.sql" (`Compliance.jsx:516`) — a file that doesn't exist; the audits panel shows a raw error with no guidance when 0005 is unapplied.

**Fix**: Replace both with a generic, accurate message: "Compliance data unavailable — ensure all database migrations have been applied (`npm run migrate`)." plus the actual error string in smaller text. Grep the whole `apps/app/src` for other hardcoded migration-file references and fix them in this task too.

**Verify**: `grep -rn "phase3\|0004_" apps/app/src` returns nothing; simulate a failing endpoint → new message renders in both panels.

---

## Wave 4 — UX improvements & David-demo adoptions

### TASK-4.1: Asset list — Next Maint. column + on-page search and Type/Location filters
- **Severity**: MEDIUM · **Category**: frontend · **Effort**: M · **Depends on**: none
- **Files**: `apps/app/src/pages/Assets.jsx`, `apps/api/src/routes/assets.ts`

**Problem**: The list (headers at `Assets.jsx:807`) has no Next Maint. column and only status pills for filtering; David's demo has a search box, Type/Location dropdowns, and a Next Maint. column — all supportable by our data (`next_maintenance_at`, `category`, `location` already in the list SELECT `assets.ts:28-38`).

**Fix**: 1) Add "Next Maint." column after Operator rendering `fmtDate(a.next_maintenance_at)` (`—` when null; amber text when date < today+14, red when past — reuse the date styling from the detail panel `Assets.jsx:600`). 2) Add a filter bar above the table: debounced search input (client-side match on name/AIN/serial over the loaded list — the org's asset count is bounded; avoid new API work), Type select (distinct categories from loaded data), Location select (from `listLocations`). Compose with the existing status pills and archived toggle. 3) Keep David's layout: search left, dropdowns right of it; reuse existing input styles.

**Verify**: type a serial fragment → list narrows; combine Type+Location+status → intersection shown; clear filters restores all.

### TASK-4.2: Expand asset status enum with `maintenance` and `standby` (BLOCKED on Decision 1)
- **Severity**: MEDIUM · **Category**: workflow · **Effort**: M · **Depends on**: Decision 1, TASK-2.3
- **Files**: new migration (next free number), `apps/api/src/routes/assets.ts:46` (zod enum), `apps/app/src/pages/Assets.jsx` (status options + badges), `apps/app/src/pages/Dashboard.jsx`, CSV template (`Assets.jsx:82-98`)

**Problem**: `check (status in ('operational','attention','critical','offline'))` (`0001:169`) cannot express "under maintenance" or "standby" — real operational states in David's model; severity is health's job after TASK-2.3.

**Fix** (per recommended decision): migration drops/recreates the check constraint as `('operational','maintenance','standby','offline','attention','critical')` (old values stay legal for existing rows). Zod enum + Add/Edit pickers + CSV import validation offer only the four new-model values. Badge map: operational green, maintenance amber, standby blue, offline red; legacy attention→amber, critical→red. Status pills on the list gain Maintenance/Standby. Dashboard "Operational" KPI counts `status='operational'` only (unchanged definition).

**Must not break**: existing rows with legacy statuses render and remain editable (picking a new status on save is fine).

**Verify**: create an asset with status `standby` → blue badge everywhere; CSV import with `status=maintenance` succeeds; import with `status=bogus` reports a row error.

### TASK-4.3: Asset detail — related work orders, inspector names, inline PM/inspection status updates
- **Severity**: MEDIUM · **Category**: feature · **Effort**: L · **Depends on**: none
- **Files**: `apps/app/src/pages/Assets.jsx`, `apps/app/src/lib/db/workOrders.js` (or equivalent client module), `apps/api/src/routes/workOrders.ts` (only if list-by-asset filter is missing)

**Problem**: The detail panel loads PM tasks and inspections (`Assets.jsx:511-512`) but not the asset's work orders (David shows them with status/priority/due); inspection rows omit the inspector's name; PM/inspection rows are read-only — your requirement "updating status of maintenance/inspections should be under the asset item" is unmet (audit M5).

**Fix**: 1) Load `listWorkOrders({asset_id})` in the panel (add the `asset_id` query filter to the WO route if absent — copy the pattern from `pmTasks.ts:42`); render cards mirroring the PM section style: ref, title, status badge, priority, due date; clicking navigates to `/work-orders` (or opens the WO detail if a modal exists). 2) Inspection rows: show `Inspector: <assignee name> · <date>` — confirm the inspections SELECT joins the assignee name; add the join if missing. 3) For users with `pm:update` / `inspection:update` (check via `can()`), render a compact status select on each PM/inspection row wired to the existing `updatePmTask` / `updateInspection` client functions; on change, optimistically update and refresh the panel. Completion via the select should route users to the proper completion modal (PM) rather than silently completing without a report.

**Must not break**: read-only users see exactly today's read-only lists.

**Verify**: as maint_engineer, change a PM task from pending → in_progress from the asset panel → persists (reload) and the Maintenance page reflects it; as viewer, no selects render.

### TASK-4.4: App-wide toast feedback system
- **Severity**: MEDIUM · **Category**: frontend · **Effort**: M · **Depends on**: none
- **Files**: new `apps/app/src/components/Toast.jsx` + context in `apps/app/src/lib/`, `apps/app/src/App.jsx`, call sites across pages

**Problem**: No toast system exists (`grep -rn "toast" apps/app/src` → empty). Mutations succeed/fail with at best inline text; David's demo toasts every action (success/error/info, bottom-right, auto-dismiss).

**Fix**: Small `ToastContext` (`useToast()` → `toast.success/error/info(msg)`), fixed bottom-right stack, 3.5s auto-dismiss, colored left border per type (match the app's existing CSS variables in `packages/ui/index.css`, not David's palette), `aria-live="polite"` container. Mount the container in `App.jsx`. Wire the highest-value call sites in this task: asset create/edit/archive/restore, CSV import result, WO create/transition, PM/inspection completion, member invite/access change, compliance save. Error toasts on caught API failures replace silent console errors.

**Verify**: create an asset → success toast appears and auto-dismisses; force a 403 (viewer attempting an edit URL) → error toast.

### TASK-4.5: Sidebar count badges (open WOs, unread notifications)
- **Severity**: LOW · **Category**: frontend · **Effort**: S · **Depends on**: none
- **Files**: `apps/app/src/components/Sidebar.jsx`, `apps/app/src/lib/NotificationsContext.jsx`, `apps/api/src/routes/dashboard.ts` (reuse counts)

**Problem/Fix**: Sidebar has no badges (grep empty). Add a red count pill on Notifications (reuse `unreadCount` from `NotificationsContext` — already consumed by `Topbar.jsx:11`) and an amber pill on Work Orders showing open count (add a lightweight `GET /work-orders/count?status=open` or reuse the dashboard KPI endpoint, refreshed on nav). Cap display at 99+.

**Verify**: with 3 open WOs and 2 unread notifications, badges show 3 and 2; marking all read clears the notification badge without reload.

### TASK-4.6: Compliance repository — filter by kind
- **Severity**: MEDIUM · **Category**: frontend · **Effort**: S · **Depends on**: none
- **Files**: `apps/app/src/pages/Compliance.jsx`

**Problem**: `kind` (`licence|permit|certificate|iso_certificate`, `0005:9-11`) is stored and badged (`Compliance.jsx:538`) but the list can only filter by expiry status (`:492-505`) — you can't view "just ISO certificates".

**Fix**: Add a kind select (All / Licence / Permit / Certificate / ISO certificate) beside the status strip, composing with the status filter client-side. Show active-filter counts ("4 ISO certificates").

**Verify**: choose ISO certificate → only `kind='iso_certificate'` rows; combine with "Expiring" → intersection.

### TASK-4.7: Reports — per-location analytics + WO cost rollups
- **Severity**: MEDIUM · **Category**: feature · **Effort**: L · **Depends on**: none
- **Files**: `apps/api/src/routes/reports.ts` or `dashboard.ts` (new aggregate endpoint), `apps/app/src/pages/Reports.jsx`, `apps/app/src/pages/WorkOrders.jsx`

**Problem**: `work_orders.cost_cents` and `estimated_hours` exist (`0001:209,264`) but are barely surfaced, and the Reports page has no location breakdowns. David's Reports shows: assets + avg health + total value per location, WO open/done + cost totals per location, asset-type breakdown.

**Fix**: 1) New endpoint returning, per location (RLS-scoped): asset count, avg health, total `purchase_value_cents`, open/completed WO counts, summed WO `cost_cents`; plus an asset-count-by-category list. One SQL with grouped joins — no N+1. 2) Render three panels on `Reports.jsx` mirroring David's layout with existing card styles: location grid (count, health bar, value), WO summary rows with cost, type-breakdown chips. 3) WO create/detail UI: expose estimated hours + cost inputs if currently hidden (check `WorkOrders.jsx` form) and show them on WO cards.

**Verify**: seeded org shows per-location numbers that match manual SQL sums; a WO created with cost 45000 appears in its location's rollup.

### TASK-4.8: Add runtime-hours and purchase-date fields to assets
- **Severity**: LOW · **Category**: feature · **Effort**: S · **Depends on**: none
- **Files**: `apps/app/src/pages/Assets.jsx`, CSV template block (`Assets.jsx:82-98`), `apps/api/src/routes/assets.ts` (import mapping `:186-196`)

**Problem**: David tracks `runtime` hours per asset and a purchase date; we store neither (install_date stands in for purchase date). `specs` jsonb (`0001:176`) accommodates both without schema change.

**Fix**: Add optional form fields "Runtime (hours)" and "Purchase date" writing `specs.runtime_hours` (int ≥ 0) and `specs.purchase_date` (date). Show both in the detail panel's spec grid. Add `runtime_hours`,`purchase_date` columns to the CSV template + import mapping (into specs, like `tags` at `assets.ts:192`).

**Verify**: create an asset with runtime 18240 → renders "18,240 hrs" in detail; CSV round-trip preserves both.

### TASK-4.9: Admin — read-only role & permissions matrix
- **Severity**: LOW · **Category**: frontend · **Effort**: S · **Depends on**: TASK-1.1
- **Files**: `apps/app/src/pages/Admin.jsx`, `apps/app/src/lib/rbac.js`

**Problem/Fix**: David renders a role×capability matrix; ours lives only in code. On the Team tab, add a collapsible "Role permissions" table generated from the `rbac.js` map (rows = roles with display names, columns = capability groups: Assets, Work Orders, Maintenance, Inspections, Compliance, Reports, Admin; ✓/– cells derived from the map, wildcards expanded). Pure render — no new API. Note per-user extra grants beneath: "Individual members may hold additional granted permissions (see each member's Access settings)."

**Verify**: matrix matches `rbac.js` (spot-check 3 cells incl. one wildcard role); changing the map in code changes the table.

## EPIC-2: Global location switcher (topbar, filters every page)
- **Verdict source**: David demo (`loc-selector` topbar control + per-page `filteredAssets()`); our per-page filters exist but there is no persistent app-wide context.
- **Target design**: a topbar dropdown "All locations / <location list>" (scoped users see only their locations; single-location users see a static label). Selection persists in localStorage + React context; list pages and dashboard aggregates apply it as an additional filter parameter. Server enforcement stays RLS — this is a UX filter INSIDE the user's permitted scope, never an access mechanism.
- **Migration strategy**: strangler — context + one page first, then remaining pages, then default-on.
- **Rollback point**: through TASK-E2.1 nothing user-visible changes.
- **Tasks**: E2.1 → E2.3

### TASK-E2.1: Location context + topbar control
- **Severity**: MEDIUM · **Category**: frontend · **Effort**: M · **Depends on**: none
- **Files**: new `apps/app/src/lib/LocationContext.jsx`, `apps/app/src/components/Topbar.jsx`, `apps/app/src/App.jsx`

**Fix**: Context exposing `{locationId, setLocationId, locations}` — locations from `listLocations()` (already RLS-scoped to what the user may see). Topbar dropdown styled like existing topbar controls (`Topbar.jsx:51` icon-button pattern), green dot + current name, "All my locations" default. Persist selection per user in localStorage; validate the stored id still exists on load. No page consumes it yet.

**Verify**: switcher renders, selection survives reload, a site-scoped user sees only their location(s) listed.

### TASK-E2.2: Apply the location filter to Assets, Work Orders, Maintenance, Inspections, Compliance
- **Severity**: MEDIUM · **Category**: frontend · **Effort**: L · **Depends on**: TASK-E2.1
- **Files**: the five list pages, their `apps/app/src/lib/db/*` client modules, corresponding API routes (add `location_id` query filter where absent — resolve to site ids server-side via the `sites.location_id` FK)

**Fix**: Each page reads `locationId` from context and passes `location_id` to its list call; API routes translate `location_id` → `site_id in (select id from sites where location_id=$1)` inside the existing RLS-scoped query. Empty-state copy says "No <items> in <location>" with a "Show all locations" reset. Per-page location dropdown from TASK-4.1 becomes subordinate: hide it when a global location is active.

**Verify**: pick Lagos → all five pages show only Lagos records; reset → everything returns. RLS test: a Delta-scoped user selecting nothing still sees only Delta.

### TASK-E2.3: Dashboard respects the global location + cleanup
- **Severity**: MEDIUM · **Category**: frontend · **Effort**: M · **Depends on**: TASK-E2.2
- **Files**: `apps/app/src/pages/Dashboard.jsx`, `apps/api/src/routes/dashboard.ts`

**Fix**: Dashboard aggregates accept `location_id` (same server-side translation); KPI cards, donut, alerts, and drill-down links (TASK-2.4) carry the active location through to the target pages. Remove/merge the dashboard's own site-filter buttons (`Dashboard.jsx:104`) into the global control — delete the redundant old control (mandatory cleanup step).

**Verify**: with Lagos active, Total Assets equals the Assets page's Lagos count; drill-down from a card lands on a Lagos-filtered list; the old inline site buttons are gone.

---

## Wave 5 — SEO/AIO/GEO & marketing

No public marketing pages exist in this repo (self-hosted internal tool). Nothing planned. (IDEA, unplanned: a public landing/status page if AssetCore is ever sold as SaaS.)

## Wave 6 — New features (IDEAs pending owner promotion)

### TASK-6.1: Live asset map page (BLOCKED on Decision 4)
- **Severity**: IDEA · **Category**: feature · **Effort**: L · **Depends on**: Decision 4, TASK-E2.1
- **Files**: new `apps/app/src/pages/Tracking.jsx`, `apps/app/src/App.jsx`, `apps/app/src/components/Sidebar.jsx`

**User story**: As an operations manager I want a map of all assets with health/status coloring so I can spot regional problems at a glance.
**Scope**: One page under a "Tracking" nav entry: an inline SVG map (Nigeria outline, as in David's demo — no external tile service, respecting the app's no-external-calls posture) plotting location clusters sized by asset count and colored by worst health band in that location; clicking a cluster applies that location via EPIC-2's context and navigates to Assets. Below, a live status table (name, location, status, health, runtime, operator) reusing the Assets list row rendering. Assets with lat/lng plot individually when zoomed/hovered; those without coordinates appear only in the table.
**Does NOT include**: real GPS/telemetry ingestion, websocket live updates (a 60s poll is fine), external map providers, mobile-specific layout work beyond the app's existing responsive rules.
**Acceptance**: page loads under 1s from cached data; clusters match per-location counts; clicking Lagos cluster lands on Lagos-filtered assets; keyboard-accessible (clusters focusable).

## Wave 7 — Cleanup & consistency

### TASK-7.1: Consistency batch — health colors, dead references, badge duplication
- **Severity**: LOW · **Category**: cleanup · **Effort**: M · **Depends on**: TASK-2.3, TASK-4.2
- **Files**: `apps/app/src/pages/*.jsx`, `apps/app/src/lib/health.js`

**Problem/Fix**: One pass across `apps/app/src`: (1) every health color/label derives from `lib/health.js` — remove residual inline threshold ternaries (`grep -n "health.*>=\|health_score <" apps/app/src -r` and migrate hits); (2) status-badge color maps are duplicated across pages — extract one `StatusBadge` component into `apps/app/src/components/` and use it in Assets/Dashboard/WorkOrders/Maintenance/Inspections; (3) delete any now-dead code from earlier waves (old dashboard site buttons if EPIC-2 shipped, unused imports, the pre-2.4 `window.location.assign` helpers); (4) `grep -rn "TODO\|FIXME" apps/` — fix trivial ones, list the rest at the bottom of this file.

**Verify**: `npm run build:app` clean (no unused-var warnings introduced); grep for inline health thresholds returns nothing outside `health.js`.

---

## Deferred / not planned

- **David's role-switch simulator** ("Switch" button impersonating any user) — an auth bypass in a real multi-tenant app; platform-admin impersonation already exists in `apps/admin` with audit logging. Not adopting.
- **David's random lat/lng on create** — fabricated data; coordinates stay optional and honest.
- **"Auto-refreshes every 30s" label** — David's is cosmetic; real polling only arrives with TASK-6.1's scoped 60s poll.
- **PDF export button** — David's is a toast stub; the app already has a real reports/export pipeline (`reportBuilders.ts`). Revisit only if a specific PDF deliverable is requested.
- **Email/SMS notification delivery** — out of scope per audit assumption; in-app only for now.
- **ExcelJS or other transitive advisories with no upstream fix** — documented in TASK-1.5, not suppressed.
- **`attention`/`critical` data migration to the new status model** — deliberately deferred until Decision 1 usage settles; the constraint keeps both worlds valid.
