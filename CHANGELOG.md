# Changelog

All notable changes to AssetCore are recorded here, starting from the
first licensed release shipped to a client (NGML).

## Unreleased

- Two NGML evaluation logins (Paul O., Hayatu S.) added as migration `0019`,
  so they are created by the same `migrate.mjs` run a deploy already performs.
  Migration `0020` then promotes both to `owner`, so the evaluation covers org
  settings, user management and licence/billing rather than only the
  operational surface. Tenant-app role only — neither is a `platform_admin`.
  Disable them when the evaluation is over: `update public.users set status =
  'disabled' where email in ('paul.o@ngml.com', 'hayatu.s@ngml.com');`

- Note for anyone adding a migration: the VPS deploy applies migrations one
  deploy late (see the appendix in `docs/DEPLOYMENT.md`), so a migration needs
  a follow-up commit on `main` before it reaches the database.

## [1.1.0] — 2026-08-02

Derived health and book value, actionable notifications, assignment
attribution, and a readable audit log. Adds four migrations (0015–0018), two
nightly jobs, and an org-wide depreciation policy under Admin → Configuration.

### Owner-review follow-ups (August 2026)

- Assignments now record and show **who did the assigning**. Work orders kept
  the assigner only as an unlabelled byline in the activity feed, under a line
  reading "Assigned to Jane Doe." — easy to misread as Jane's own entry. PM
  tasks recorded it nowhere at all (no activity table, and the assignee-change
  path never wrote an audit entry), and inspections only as a generic
  `inspection.update` with no `before`. All three now carry `assigned_by` /
  `assigned_at`, surfaced on the work-order detail, in the PM task and
  inspection lists, and in the reassign dialog. Existing work orders are
  backfilled from their activity history.
- The assignment notification says who assigned it. `wo_assigned` previously
  used the activity body as its text, which meant the recipient was told
  "Assigned to <their own name>" — redundant, and it spent the only free text
  field on something they already knew. Notifications also gained `actor_id`;
  `notify_users()` had always received the actor and discarded it after a
  self-exclusion check.
- Fixed: the "work order closed" notification identified the assigner by taking
  the most recent assignment activity row — but unassigning writes one of those
  too, so if A assigned and B later unassigned, B was notified as the assigner.
  It now reads the column.
- The **audit log is readable**. Entries rendered a raw action string, a raw
  entity type, and `entity_id.slice(0, 8)` — the first eight hex characters of
  a UUID, not even a complete one, so it could not be pasted into a lookup.
  Rows now carry a human label written with the row (`WO-2026-0002 — Pump seal
  replacement`), and the action renders in plain English ("Changed work order
  status"). Existing rows are backfilled.
  - The label is a **snapshot**, not a lookup: an audit log is a historical
    record, and asset categories are hard-deleted, so a read-time join loses
    the name at exactly the moment the delete entry becomes interesting.
  - Two resolution traps handled: `membership` rows store a `users.id` for
    invites but a `memberships.id` for everything else, and `maintenance_event`
    has no name column at all (its label is synthesised from the asset).
  - The per-asset activity timeline uses the same labels, so system events read
    like the human ones they sit beside instead of as grey monospace.
  - Also: the audit list had no ordering tiebreaker, so rows written in one
    transaction could shuffle between pages; the timestamp showed no year or
    seconds; and the fifth column rendered `ip`, which no tenant code path has
    ever populated.

- Asset health is no longer something anyone types. It has always been derived
  — a linear decay from 100% at the last maintenance date to 0% at the next —
  but the asset form still offered an "Initial health %" field, the CSV import
  still accepted a `health_score` column, and the API still honoured both, so a
  typed value survived only until the next nightly run. The field, the column
  and the API parameter are gone, and the request is now rejected outright
  rather than silently ignored. To make that safe, the per-row half of the
  decay is callable on its own (`recompute_asset_health_for`), so a newly
  registered asset has a correct score in the same request instead of null
  until 01:00, and moving either maintenance date recalculates immediately.
  The CSV import goes through the same path, which incidentally fixes imported
  low-health assets never raising an inspection or an auto-drafted work order.
- Depreciation. `assets.nbv_cents` was read by the asset panel and the asset
  register report and written by nothing but the seed script — every book value
  the product ever showed was fiction. Book value and accumulated depreciation
  are now computed from purchase value, in-service date and an admin-chosen
  org-wide policy (straight-line or declining balance, with useful life and
  residual value), overridable per asset, configured in Admin → Configuration.
  Recomputed nightly, on any asset write that moves an input, and across the
  whole register the moment the policy changes. An asset with no purchase value
  or no start date reports no book value rather than zero. `purchase_date` and
  `install_date` were promoted from untyped `specs` JSON keys to real date
  columns, backfilled in place.
- Notifications are actionable. Every notification has always carried
  `(entity_type, entity_id)`; nothing turned that into a route, so a
  notification was a dead end. Clicking one now opens the work order,
  inspection, task, asset or licence it is about, from both the list and the
  detail pane. The list item was also rebuilt from four stacked full-width
  strips into two lines — title and time on one, kind and body on the next —
  and the "Dismiss" button, which had no click handler at all, is now a working
  "Mark as unread".
- Notification coverage gaps closed: `inspection_due`, `maintenance_due` and
  `pm_overdue` inserted rows directly and so ignored the per-user preferences
  the UI offered; all three now go through the preference-aware helpers.
  `maintenance_due` fired before the auto-work-order dedupe check and could
  announce a work order that was never drafted. Work-order comments now also
  reach whoever raised the order, and work-order attachments now notify at all.
  `pm_due` had a preferences toggle and no producer anywhere in the codebase —
  it now has one; `system` had neither and its toggle is removed.
- The Maintenance page's subtitle promised "preventive maintenance, inspections
  & compliance" and delivered one of the three: its Inspections tab was a
  "Phase 3 — coming soon" panel and its Compliance tab rendered seven hardcoded
  fake licences with a dead "Renew" button, both while real Inspections and
  Compliance pages existed and worked. The two features are extracted into
  shared panels mounted by both the standalone pages and these tabs, so there
  is one implementation, live data, and tab badges computed from real counts
  instead of a literal `7`.
- "Maintenance" is gone from the status picker when adding an asset. It is an
  operational state the system derives: a work order moving to in progress puts
  its asset under maintenance and closing the last one takes it back out,
  recorded in the asset's activity timeline. The asset registry's filter row
  also stopped mixing two axes — operational state and health-derived severity
  are now separate, labelled controls, and the legacy attention/critical values
  only appear while rows still carry them.
- Work orders in the asset detail panel now show who they are assigned to and
  when they were raised, and clicking one opens that work order instead of
  dumping you on an unfiltered list. Raising a work order from an asset can
  assign it at creation, which only the Work Orders page could do before.
- Security: `POST`/`PATCH`/`DELETE /devices` had no capability check at all —
  any active member, including read-only viewer and auditor roles, could
  create, edit and delete devices. Now gated on `asset:update`.
- Per-user granted capabilities were ignored almost everywhere in the UI.
  `can()` takes an `extraCaps` argument that only two pages passed, so an
  admin could grant a capability in Admin → Access settings, the API would
  honour it, and the button would still never appear. Every call site passes it
  now. Three capability gates also named the wrong capability outright: "Add
  Licence" checked `wo:create` instead of `compliance:create` (hiding it from
  the HSE officer role that owns compliance), and "Schedule PM" and "Generate
  Tasks" checked `wo:create` instead of `pm:create`.
- The topbar search box was decorative — no state, no handler, no results. It
  now searches assets by AIN/name and work orders by ref/title. PM schedules
  can be archived (the function was imported and never called). Asset value is
  labelled and rendered in naira everywhere, matching the reports and work
  orders rather than contradicting them with a dollar sign.

## [1.0.0] — 2026-07-23

### Owner-review follow-ups (July 2026)

- Auto-generated work orders now land in a real `draft` status with an
  explicit Approve/Dismiss step (previously they arrived as `new`,
  indistinguishable from human-created WOs).
- The 30% maintenance/auto-WO health threshold is now org-configurable
  (Admin → Configuration), alongside the existing inspection threshold; the
  UI enforces maintenance < inspection. Defaults unchanged (30/50).
- Work orders are now editable and assignable from the UI (title,
  description, type, priority, SLA, cost + assignee picker for `wo:assign`
  holders, on both create and edit) — the PATCH endpoint existed but had no
  UI.
- Last/next maintenance dates are now required when creating an asset (form,
  API, and CSV import) so every asset participates in the daily health-decay
  job instead of silently sitting at its initial health forever.
- Role→capability RBAC map extracted to a shared workspace package
  (`@assetcore/rbac`) consumed by both the app and the API — removes the
  hand-mirrored copies that had already drifted (the Admin UI offered only a
  subset of the capabilities the API accepted).
- PM tasks/schedules and inspections can now be assigned/reassigned from the
  UI (Maintenance and Inspections pages) — the `assignee_id`/`inspector_id`
  columns and API support existed since day one, but nothing let a user set
  them.
- Assigning a work order, PM task, or inspection now notifies the assignee
  (`wo_assigned`, `pm_assigned`, `inspection_assigned`); completing one, or
  uploading its report, now notifies the assigner/creator and supervisors
  (`work_completed`, `report_uploaded`) — previously nothing generated a
  notification for any of this, and `wo_assigned` was a dead stub referenced
  only in the notification-preferences UI.
- "Assigned to me" filters on the Work Orders, Maintenance, and Inspections
  lists, plus a "My Open Work" dashboard card, so it's visible at a glance
  who is handling what.

First licensed on-prem release. Supersedes the pre-1.0 Supabase-based SaaS
prototype entirely — nothing before this line was ever deployed to a client.

- Plain PostgreSQL 16 + custom `apps/api` (Node/Express/TypeScript) + nginx,
  replacing the Supabase stack (GoTrue/PostgREST/Realtime/Storage/Kong).
  We own auth (argon2id + JWT + refresh-cookie rotation); RLS kept as
  defense-in-depth against a non-owner `assetcore_app` DB role.
- Login-only front door, no self-serve signup — this is a licensed,
  client-hosted product, not a SaaS.
- Provisioning (`scripts/provision.mjs`) and soft licence enforcement
  (expiry banners, never a hard lock).
- Real tenant user management (invite/role/disable), replacing a static
  mock table.
- Backoffice (`apps/admin`) repositioned as AssetCore's internal
  client-instance console, not a multi-tenant SaaS control panel.
- Live dashboard alerts (overdue PM, expiring licences, critical work
  orders, offline devices), real report generation (XLSX/CSV via exceljs),
  and file uploads (asset photos, work order attachments, compliance
  documents) — replacing the remaining UI stubs and simulated data.
- Docker Compose deployment packaging (`deploy/`), operational runbooks
  (`docs/`), and a release tarball builder (`scripts/package.mjs`).
