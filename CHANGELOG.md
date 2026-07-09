# Changelog

All notable changes to AssetCore are recorded here, starting from the
first licensed release shipped to a client (NGML).

## [1.0.0] — unreleased

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
