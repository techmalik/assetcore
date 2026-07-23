# Changelog

All notable changes to AssetCore are recorded here, starting from the
first licensed release shipped to a client (NGML).

## [1.0.0] — unreleased

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
