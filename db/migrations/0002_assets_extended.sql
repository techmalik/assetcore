-- ============================================================================
-- 0002_assets_extended
-- Adds the richer asset registry fields surfaced in the Add/Edit Asset form
-- (assigned operator, last/next maintenance dates, uploaded documents) and a
-- per-asset activity feed (comments / actions / alerts), mirroring the existing
-- work_order_activity pattern. Health-lifecycle automation that also uses the
-- maintenance-date columns lands in a later migration.
-- ============================================================================

alter table public.assets
  add column if not exists assigned_operator_id uuid references public.users(id) on delete set null,
  add column if not exists last_maintenance_at  date,
  add column if not exists next_maintenance_at  date,
  add column if not exists documents            jsonb not null default '[]'::jsonb;

-- ----------------------------------------------------------------------------
-- asset_activity — comments / status changes / attachments / alerts for an
-- asset. The per-asset timeline in the UI UNIONs this (human/system events)
-- with audit_log rows for the same asset. Append-only, like audit_log.
-- ----------------------------------------------------------------------------
create table if not exists public.asset_activity (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  asset_id    uuid not null references public.assets(id) on delete cascade,
  user_id     uuid references public.users(id) on delete set null,
  kind        text not null default 'comment'
                check (kind in ('comment','status_change','attachment','alert','maintenance','inspection')),
  body        text,
  attachments jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists asset_activity_asset_idx on public.asset_activity (asset_id, created_at desc);

alter table public.asset_activity enable row level security;

-- Scoped to the caller's org, matching the other tenant tables. Append + read
-- only (no update/delete grant) — an activity feed is not editable history.
create policy asset_activity_sel on public.asset_activity for select
  using (org_id = current_org_id());
create policy asset_activity_ins on public.asset_activity for insert
  with check (org_id = current_org_id());

grant select, insert on public.asset_activity to assetcore_app;
