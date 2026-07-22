# AssetCore Audit Report

Audited at: `main @ bd9138b` (2026-07-22) · Method: five parallel code audits (assets, health lifecycle, dashboard, RBAC/locations, compliance) + verification greps + review of David's demo (`assetcore_1.html`, kept outside the repo as a reference artifact).

## Executive summary

Overall health: **good core, sharp edges**. The recent 8-commit push (`bf868d5..bd9138b`) implemented the bulk of the requirements checklist: full asset registry (fields, CSV import, archive/restore, activity log, attachments with 5-image cap), Location→Site hierarchy with RLS-enforced scoping, granular roles + per-user grants, health decay automation with configurable inspection threshold, 30% auto work order + red notification, compliance/ISO repository with expiry alerts.

Counts: **5 CRITICAL · 8 HIGH · 8 MEDIUM · ~10 LOW/IDEA**.

The three most important things:
1. **Ungated admin APIs** — `sites.ts`, `locations.ts`, and `categories.ts` write routes have no capability check; any active member (including read-only Auditor/Viewer) can create/edit/delete the org's location hierarchy and categories.
2. **The health loop doesn't close** — only PM-task completion resets health to 100; work-order-driven maintenance never does, manual health edits bypass the 50%/30% triggers entirely (they only run in the 01:00 cron), and assets whose `next_maintenance_at <= last_maintenance_at` are silently skipped by the decay job forever.
3. **Client-controlled attachment arrays** — `photos` and `documents` are accepted verbatim in asset create/PATCH (`assets.ts:21-25`, `assetInput`), bypassing the upload endpoints, the MIME expectations, and the 5-photo cap.

## CRITICAL

| # | Finding | Evidence |
|---|---|---|
| C1 | Sites/locations/categories write routes unauthenticated beyond membership — no `requireCap` | `sites.ts:12`, `locations.ts:12`, `categories.ts:12` (router.use has only requireAuth/requireOrg/requireActiveMembership); every other write router gates (`assets.ts:127`, `workOrders.ts:111`) |
| C2 | `compliance_audits` RLS: SELECT is site-scoped but INSERT/UPDATE check org only; UPDATE has no `with check` — scoped staff can write audits for out-of-scope sites | `0005_compliance_iso.sql:56-61` |
| C3 | `photos`/`documents` writable via create/PATCH as raw arrays — bypasses 5-image cap and upload validation | `assets.ts:21-25` (ALLOWED), `assets.ts:55,59` (zod `z.array(z.unknown())`) |
| C4 | Child artifacts (files, activity) authorized by org only, not site scope — scoped user can fetch out-of-scope files/activity by id | RLS scope applies to parent tables only (`0004_locations_rbac.sql:84-125`); `files.ts` serves by path once org matches |
| C5 | Dependency advisories unresolved (nodemailer 6.9.x, multer 1.4.5-lts, node-cron 3.x pinned; no `npm audit` in CI) | `apps/api/package.json:24-26` |

## HIGH

| # | Finding | Evidence |
|---|---|---|
| H1 | Work-order completion never resets health/maintenance dates — the 30% → auto-WO → repair loop can't recover the asset | `workOrders.ts:156-193` (closed transition touches nothing); only `pmTasks.ts:80-88` resets |
| H2 | Decay job skips assets where `next_maintenance_at <= last_maintenance_at` (health pinned at 100 forever) | `0003_health_lifecycle.sql:41` (`where next > last`); reset at `pmTasks.ts:80-88` can write past-due `next_due` |
| H3 | Manual health edits bypass 50%/30% crossing triggers until the next 01:00 cron | `assets.ts` PATCH allows `health_score`; crossing logic only inside `recompute_asset_health()` (`0003:51-102`) |
| H4 | 50% trigger sends a notification but creates **no inspection record** | `0003:51-70` inserts into notifications/asset_activity only, never `public.inspections` |
| H5 | Dashboard health donut buckets by manual `status`, not `health_score` — contradicts the >50/31–50/≤30 color spec | `dashboard.ts:20-32`, `Dashboard.jsx:200-228`; correct bands live in `apps/app/src/lib/health.js:10-19` |
| H6 | Dashboard drill-down incomplete: only 2 of 7 aggregates filter; WorkOrders/Maintenance/Compliance pages don't read URL params; donut segments + alert rows not clickable; footer links full-page reload | `Dashboard.jsx:161,170,179` (no params), `WorkOrders.jsx:298`, `Maintenance.jsx:101`, `Compliance.jsx:410,418`, `Dashboard.jsx:200-238,263-270,285,336` |
| H7 | Inspection-threshold setting: UI enables save for `org:manage` but `org_update` RLS is owner-only → silent 403 for ops managers | `Admin.jsx:820-871` vs `0001_baseline.sql:889` |
| H8 | Access changes lag until token refresh (role/caps/scope baked into JWT); disabled members keep access until expiry | `auth/routes.ts:61-76` (resolveSiteIds at login), `rbac.ts:45-46` (extra_caps from claims) |

## MEDIUM

| # | Finding | Evidence |
|---|---|---|
| M1 | Expiry alerts fire only at exactly 90/30/7 days — a missed cron day means the alert never fires; recipients limited to owner/ops_manager; notification_preferences ignored by all SQL-generated notifications | `0001:609-655` (esp. `:627,:631`), `Notifications.jsx:51-61` |
| M2 | "Routine maintenance compliance" is a self-clicked Yes/No; no computed on-time PM completion metric anywhere; AuditModal can't link an audit to an asset though `asset_id` exists | `0005:37`, `Compliance.jsx:307-310`, `compliance.ts:156` |
| M3 | Two independent WO ref counters (SQL auto-WO vs API) can collide transiently | `0003:88-91` vs `workOrders.ts:102-108` |
| M4 | Certificate repository has no kind filter in UI (licence/permit/certificate/iso_certificate exists in data) | `0005:9-11`, `Compliance.jsx:492-505` |
| M5 | No PM/inspection status controls in asset detail (read-only lists; only Raise WO) | `Assets.jsx:590-630` |
| M6 | Upload failures can orphan files on disk; upload/removal not audit-logged consistently | `files.ts`, `assets.ts:250-281` |
| M7 | Zero automated tests in the repo | no test files, no runner configured |
| M8 | Stale error hint tells users to run `0004_phase3.sql` (wrong file name); audits panel shows raw error if 0005 unapplied | `Compliance.jsx:516` |

## LOW / IDEA (from David's demo review + sweep)

- Asset list lacks: Next Maint. column, on-page search, Type/Location dropdown filters (David has all four; our data supports them).
- Status enum lacks `maintenance`/`standby` operational states (David's set: operational/maintenance/standby/offline).
- Asset detail lacks: related work orders list, inspector names on inspection rows, runtime-hours field.
- No toast feedback system; no sidebar count badges (open WOs, unread notifications).
- No global location switcher in topbar (David filters every page through one).
- No read-only role-permission matrix view in Admin (David renders one; ours exists in code at `rbac.js`).
- Reports page lacks per-location analytics (asset distribution, WO cost rollups — `cost_cents`/`estimated_hours` already in schema at `0001:209,264` but unsurfaced).
- IDEA: Live tracking/map page using existing lat/lng.
- Not borrowed (deliberately): David's role-switch simulator (auth bypass), fake auto-refresh label, random coordinates on create, PDF-export stub.

## Coverage statement

Fully read: all five migrations, `assets.ts`, `compliance.ts`, `sites.ts`, `locations.ts`, `categories.ts`, `orgMembers.ts`, `auth/routes.ts`, `jobs.ts`, `Assets.jsx`, `Dashboard.jsx`, `Compliance.jsx`, `Admin.jsx` (key ranges), `Sidebar.jsx`, `Topbar.jsx`, `health.js`, `rbac.ts`/`rbac.js`, David's full demo HTML. Sampled: `WorkOrders.jsx`, `Maintenance.jsx`, `Inspections.jsx`, `reports.ts`, `dashboard.ts`, `files.ts`. Unverified: exact `npm audit` output (network-dependent — run during TASK-1.5); email delivery paths.
