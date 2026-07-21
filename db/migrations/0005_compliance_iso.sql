-- ============================================================================
-- 0005_compliance_iso
-- Turns the compliance module into a certificate repository (licences, permits,
-- ISO and other certificates) with multi-document support and adds a lightweight
-- ISO / routine-maintenance audit-attestation record.
-- ============================================================================

-- Categorise each compliance record; keep licence_number as the reference/cert number.
alter table public.compliance_licences
  add column if not exists kind text not null default 'licence'
    check (kind in ('licence', 'permit', 'certificate', 'iso_certificate'));

-- Multi-document support (data sheets / scans). Backfill the existing single
-- document_url into the new array so nothing is lost.
alter table public.compliance_licences
  add column if not exists documents jsonb not null default '[]'::jsonb;

update public.compliance_licences
set documents = jsonb_build_array(jsonb_build_object('url', document_url, 'name', split_part(document_url, '/', -1)))
where document_url is not null
  and (documents is null or jsonb_array_length(documents) = 0);

-- ----------------------------------------------------------------------------
-- compliance_audits — attestations: "complied with routine maintenance?",
-- "audit conducted per ISO standard?", with an ISO reference and optional doc.
-- ----------------------------------------------------------------------------
create table if not exists public.compliance_audits (
  id                           uuid primary key default gen_random_uuid(),
  org_id                       uuid not null references public.organizations(id) on delete cascade,
  site_id                      uuid references public.sites(id) on delete set null,
  asset_id                     uuid references public.assets(id) on delete set null,
  title                        text not null,
  standard                     text,            -- e.g. "ISO 9001", "ISO 14001"
  iso_reference                text,            -- certificate reference number
  audit_date                   date not null,
  auditor_id                   uuid references public.users(id) on delete set null,
  routine_maintenance_complied boolean,
  iso_audit_conducted          boolean,
  answers                      jsonb not null default '{}'::jsonb,
  notes                        text,
  document_url                 text,
  created_by                   uuid references public.users(id) on delete set null,
  created_at                   timestamptz default now(),
  updated_at                   timestamptz default now(),
  deleted_at                   timestamptz
);
create index if not exists compliance_audits_org_idx on public.compliance_audits (org_id, audit_date desc);

create trigger compliance_audits_updated_at
  before update on public.compliance_audits
  for each row execute function public.set_updated_at();

alter table public.compliance_audits enable row level security;

-- Org-scoped, plus site scope so scoped staff only see their sites' audits.
create policy comp_audits_sel on public.compliance_audits for select
  using (org_id = current_org_id() and (current_site_ids() is null or site_id is null or site_id = any(current_site_ids())));
create policy comp_audits_ins on public.compliance_audits for insert
  with check (org_id = current_org_id());
create policy comp_audits_upd on public.compliance_audits for update
  using (org_id = current_org_id());

grant select, insert, update on public.compliance_audits to assetcore_app;
