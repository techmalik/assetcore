-- ============================================================================
-- AssetCore — 0002_phase1_asset_core
-- Phase 1 of the gap-closure plan: make the asset record real.
--
--   1. assets           — nameplate, lifecycle, criticality, financial basis
--   2. asset_categories — depreciation defaults new assets inherit
--   3. documents        — one typed registry replacing three ad-hoc file stores
--
-- Everything here is additive. No column is dropped or retyped, so 0001 data
-- survives untouched and the API keeps working before the routes catch up.
--
-- Deliberate note on health_score: it stays a manual 0-100 integer, but gains
-- a `health_score_source` marker so Phase 3's scoring engine can compute it
-- for most assets while leaving explicit manual overrides alone. Until then
-- the UI must present it as entered, not derived.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. assets — nameplate, lifecycle and financial basis
-- ----------------------------------------------------------------------------

-- Where the asset is in its life. Distinct from `status`, which is condition
-- (operational/attention/critical/offline) — an asset can be `in_service` and
-- `critical` at the same time, which the single 0001 column could not express.
alter table public.assets
  add column if not exists lifecycle_status text not null default 'in_service'
    check (lifecycle_status in ('planned','in_service','standby','under_maintenance','in_storage','disposed'));

-- Consequence of failure. Drives work order priority, health weighting and
-- the risk register in Phase 3/4.
alter table public.assets
  add column if not exists criticality text not null default 'medium'
    check (criticality in ('low','medium','high','critical'));

-- Nameplate
alter table public.assets add column if not exists manufacturer  text;
alter table public.assets add column if not exists model         text;
alter table public.assets add column if not exists serial_number text;
alter table public.assets add column if not exists supplier      text;

-- Lifecycle dates
alter table public.assets add column if not exists purchase_date    date;
alter table public.assets add column if not exists commission_date  date;
alter table public.assets add column if not exists warranty_expiry  date;

-- Depreciation basis. Phase 2 reads these to build a schedule; until then they
-- are captured but unused, and nbv_cents stays a manual figure.
alter table public.assets add column if not exists useful_life_years   numeric(4,1);
alter table public.assets add column if not exists salvage_value_cents bigint;
alter table public.assets
  add column if not exists depreciation_method text
    check (depreciation_method in ('straight_line','declining_balance','sum_of_years_digits','units_of_production'));

-- Who is accountable for the asset itself (not for a given work order).
alter table public.assets
  add column if not exists custodian_id uuid references public.users(id) on delete set null;

alter table public.assets add column if not exists tags  text[] not null default '{}';
alter table public.assets add column if not exists notes text;

-- 'manual' = a person typed the score. 'computed' = Phase 3's engine owns it.
alter table public.assets
  add column if not exists health_score_source text not null default 'manual'
    check (health_score_source in ('manual','computed'));

create index if not exists assets_org_criticality_idx on public.assets (org_id, criticality)
  where deleted_at is null;
create index if not exists assets_org_lifecycle_idx on public.assets (org_id, lifecycle_status)
  where deleted_at is null;
-- Powers the warranty-expiry surface on the asset list and, later, its alerts.
create index if not exists assets_warranty_idx on public.assets (org_id, warranty_expiry)
  where deleted_at is null and warranty_expiry is not null;
create index if not exists assets_custodian_idx on public.assets (org_id, custodian_id)
  where deleted_at is null;
create index if not exists assets_tags_idx on public.assets using gin (tags);

-- ----------------------------------------------------------------------------
-- 2. asset_categories — defaults inherited by new assets
-- ----------------------------------------------------------------------------
alter table public.asset_categories
  add column if not exists depreciation_method text not null default 'straight_line'
    check (depreciation_method in ('straight_line','declining_balance','sum_of_years_digits','units_of_production'));
alter table public.asset_categories
  add column if not exists useful_life_years numeric(4,1);
alter table public.asset_categories
  add column if not exists salvage_value_percent numeric(5,2)
    check (salvage_value_percent is null or (salvage_value_percent >= 0 and salvage_value_percent <= 100));
alter table public.asset_categories add column if not exists description text;

-- ----------------------------------------------------------------------------
-- 3. documents — one typed registry
--
-- Replaces assets.photos (JSON), work_order_activity.attachments (JSON) and
-- compliance_licences.document_url (single text column). Those columns stay in
-- place for now so nothing breaks mid-migration; a later phase drops them once
-- every write path targets this table.
--
-- storage_path is relative to FILES_DIR/{org_id}/ — the same convention
-- apps/api/src/files.ts already serves from, so downloads need no new plumbing.
-- ----------------------------------------------------------------------------
create table if not exists public.documents (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organizations(id) on delete cascade,

  -- Exactly one parent, enforced below.
  asset_id              uuid references public.assets(id) on delete cascade,
  work_order_id         uuid references public.work_orders(id) on delete cascade,
  inspection_id         uuid references public.inspections(id) on delete cascade,
  compliance_licence_id uuid references public.compliance_licences(id) on delete cascade,

  kind                  text not null default 'other'
                          check (kind in ('photo','manual','warranty','certificate','drawing','report','invoice','other')),
  file_name             text not null,
  storage_path          text not null,
  content_type          text not null default 'application/octet-stream',
  size_bytes            bigint not null default 0,
  description           text,
  uploaded_by           uuid references public.users(id) on delete set null,
  created_at            timestamptz not null default now(),
  deleted_at            timestamptz,

  constraint documents_exactly_one_parent check (
    (asset_id is not null)::int
    + (work_order_id is not null)::int
    + (inspection_id is not null)::int
    + (compliance_licence_id is not null)::int = 1
  )
);

create index if not exists documents_asset_idx     on public.documents (asset_id)      where deleted_at is null;
create index if not exists documents_wo_idx        on public.documents (work_order_id) where deleted_at is null;
create index if not exists documents_insp_idx      on public.documents (inspection_id) where deleted_at is null;
create index if not exists documents_licence_idx   on public.documents (compliance_licence_id) where deleted_at is null;
create index if not exists documents_org_kind_idx  on public.documents (org_id, kind)  where deleted_at is null;

alter table public.documents enable row level security;

create policy documents_sel on public.documents for select using (org_id = current_org_id());
create policy documents_ins on public.documents for insert with check (org_id = current_org_id());
create policy documents_upd on public.documents for update using (org_id = current_org_id());

grant select, insert, update on public.documents to assetcore_app;
