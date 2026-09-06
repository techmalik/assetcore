-- ============================================================================
-- 0021_asset_master_and_documents
--
-- First of four migrations bringing a parallel branch's work onto this
-- lineage. That branch built Phases 1-4 of a gap ledger against a base that
-- has since moved 50 commits; this series ports what it added, drops what
-- this lineage already does better, and merges the two where both had a go.
--
-- What is deliberately NOT here, because 0015 already covers it:
--   purchase_date, useful_life_years, salvage_value_cents,
--   depreciation_method   — 0015 added all four, with org-level policy
--                           inheritance the other branch never had.
--   install_date          — the other branch called it commission_date.
--                           Same field; this lineage's name wins.
--   assigned_operator_id  — the other branch called it custodian_id.
--                           Same idea; this lineage's name wins.
--   health_score_source   — the other branch kept a manual override on the
--                           health score. 0016 removed manual entry on
--                           purpose, and that decision stands: a number the
--                           01:00 cron silently overwrites is a lie in the
--                           UI. Nothing here reintroduces it.
--
-- What IS here is the nameplate and lifecycle detail this lineage has no
-- home for, and a typed document registry to replace three ad-hoc file
-- stores.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Assets — nameplate and lifecycle
--
-- `status` is condition (operational/attention/critical/offline/...);
-- lifecycle_status is where the asset is in its life. They are separate axes:
-- an asset can be in_service and critical at the same time, which the single
-- status column cannot express.
-- ----------------------------------------------------------------------------
alter table public.assets
  add column if not exists lifecycle_status text not null default 'in_service';
alter table public.assets add column if not exists criticality text not null default 'medium';
alter table public.assets add column if not exists manufacturer  text;
alter table public.assets add column if not exists model         text;
alter table public.assets add column if not exists serial_number text;
alter table public.assets add column if not exists supplier      text;
alter table public.assets add column if not exists warranty_expiry date;
alter table public.assets add column if not exists tags  text[] not null default '{}';
alter table public.assets add column if not exists notes text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'assets_lifecycle_status_check') then
    alter table public.assets add constraint assets_lifecycle_status_check
      check (lifecycle_status in ('planned','in_service','standby','under_maintenance','in_storage','disposed'));
  end if;
  -- Consequence of failure. Drives work order priority and, once 0024 lands,
  -- is the fallback the risk signal reads when an asset has no assessment.
  if not exists (select 1 from pg_constraint where conname = 'assets_criticality_check') then
    alter table public.assets add constraint assets_criticality_check
      check (criticality in ('low','medium','high','critical'));
  end if;
end $$;

create index if not exists assets_org_criticality_idx on public.assets (org_id, criticality)
  where deleted_at is null;
create index if not exists assets_lifecycle_idx on public.assets (org_id, lifecycle_status)
  where deleted_at is null;

-- ----------------------------------------------------------------------------
-- 2. Asset categories — depreciation defaults new assets inherit
--
-- 0015 resolves depreciation policy per-asset then org-wide. A category sits
-- usefully between the two: every pump depreciates alike, and an organisation
-- that set its categories once should not retype the figure on each one.
-- recompute_asset_depreciation_for() picks these up in 0022.
-- ----------------------------------------------------------------------------
alter table public.asset_categories add column if not exists description text;
alter table public.asset_categories add column if not exists depreciation_method text;
alter table public.asset_categories add column if not exists useful_life_years numeric(5,2);
alter table public.asset_categories add column if not exists salvage_rate_pct numeric(5,2);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'asset_categories_depreciation_method_check') then
    alter table public.asset_categories add constraint asset_categories_depreciation_method_check
      check (depreciation_method is null
             or depreciation_method in ('none','straight_line','declining_balance','sum_of_years_digits'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'asset_categories_salvage_rate_check') then
    alter table public.asset_categories add constraint asset_categories_salvage_rate_check
      check (salvage_rate_pct is null or (salvage_rate_pct >= 0 and salvage_rate_pct <= 100));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. documents — one typed registry
--
-- Files currently live in three unrelated shapes: assets.documents (jsonb),
-- inspections.report_url (single text column) and
-- compliance_licences.document_url (ditto). None of them records who uploaded
-- what, when, what kind of document it is, or how big it was, and none can be
-- listed across an organisation.
--
-- Those columns stay for now so nothing breaks mid-migration; the API writes
-- here from this release on, and a later migration drops them once every read
-- path has moved.
--
-- storage_path is relative to FILES_DIR/{org_id}/, the convention
-- apps/api/src/files.ts already serves from, so downloads need no new plumbing.
-- ----------------------------------------------------------------------------
create table if not exists public.documents (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,

  -- Exactly one parent, enforced below.
  asset_id        uuid references public.assets(id) on delete cascade,
  work_order_id   uuid references public.work_orders(id) on delete cascade,
  inspection_id   uuid references public.inspections(id) on delete cascade,
  licence_id      uuid references public.compliance_licences(id) on delete cascade,

  kind            text not null default 'other'
                    check (kind in ('photo','manual','warranty','certificate','drawing','report','invoice','other')),
  title           text not null,
  description     text,
  storage_path    text not null,
  mime_type       text,
  size_bytes      bigint,
  uploaded_by     uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz,

  constraint documents_one_parent check (
    (case when asset_id      is not null then 1 else 0 end
   + case when work_order_id is not null then 1 else 0 end
   + case when inspection_id is not null then 1 else 0 end
   + case when licence_id    is not null then 1 else 0 end) = 1
  )
);
create index if not exists documents_asset_idx      on public.documents (asset_id)      where deleted_at is null;
create index if not exists documents_wo_idx         on public.documents (work_order_id) where deleted_at is null;
create index if not exists documents_inspection_idx on public.documents (inspection_id) where deleted_at is null;
create index if not exists documents_licence_idx    on public.documents (licence_id)    where deleted_at is null;
create index if not exists documents_org_idx        on public.documents (org_id, created_at desc) where deleted_at is null;

-- ----------------------------------------------------------------------------
-- 4. Row-level security + grants
-- ----------------------------------------------------------------------------
alter table public.documents enable row level security;

create policy documents_all on public.documents for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());

grant select, insert, update, delete on public.documents to assetcore_app;
