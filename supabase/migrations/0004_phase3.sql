-- Phase 3: regulatory_authorities, compliance_licences, inspections, reports, approvals
-- Plus: licence expiry notification function

-- ── Regulatory Authorities (global reference — no RLS, no org_id) ─────────────

create table public.regulatory_authorities (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  code         text not null unique,
  jurisdiction text not null default 'Federal',
  sector       text
);

insert into public.regulatory_authorities (name, code, jurisdiction, sector) values
  ('Nigerian Midstream and Downstream Petroleum Regulatory Authority', 'NMDPRA', 'Federal', 'Oil & Gas'),
  ('Nigerian Upstream Petroleum Regulatory Commission',                'NUPRC',  'Federal', 'Oil & Gas'),
  ('National Environmental Standards Regulation Enforcement Agency',  'NESREA', 'Federal', 'Environment'),
  ('Standards Organisation of Nigeria',                               'SON',    'Federal', 'Standards'),
  ('Nigeria Security and Civil Defence Corps',                        'NSCDC',  'Federal', 'Security'),
  ('Nigerian Safety Commission',                                      'NSC',    'Federal', 'Safety'),
  ('National Metrological Institute',                                 'NMI',    'Federal', 'Metrology'),
  ('Federal Road Safety Corps',                                       'FRSC',   'Federal', 'Transport');

grant select on public.regulatory_authorities to authenticated, anon;

-- ── Compliance Licences ────────────────────────────────────────────────────────

create table public.compliance_licences (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  site_id         uuid references public.sites(id) on delete set null,
  asset_id        uuid references public.assets(id) on delete set null,
  authority_id    uuid references public.regulatory_authorities(id) on delete set null,
  name            text not null,
  licence_number  text,
  issued_date     date not null,
  expiry_date     date not null,
  notes           text,
  document_url    text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  deleted_at      timestamptz
);

-- Immutable helper: derive status from expiry_date at query time
create or replace function public.licence_status(p_expiry date)
returns text language sql immutable as $$
  select case
    when p_expiry < current_date               then 'expired'
    when p_expiry < current_date + interval '30 days' then 'expiring'
    when p_expiry < current_date + interval '90 days' then 'due_soon'
    else 'active'
  end
$$;

create trigger compliance_licences_updated_at
  before update on public.compliance_licences
  for each row execute function public.set_updated_at();

create index cl_org_idx    on public.compliance_licences (org_id) where deleted_at is null;
create index cl_expiry_idx on public.compliance_licences (org_id, expiry_date) where deleted_at is null;

alter table public.compliance_licences enable row level security;
create policy cl_sel on public.compliance_licences for select using (org_id = (auth.jwt()->>'org_id')::uuid);
create policy cl_ins on public.compliance_licences for insert with check (org_id = (auth.jwt()->>'org_id')::uuid);
create policy cl_upd on public.compliance_licences for update using (org_id = (auth.jwt()->>'org_id')::uuid);

-- ── Inspections ───────────────────────────────────────────────────────────────

create table public.inspections (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  asset_id         uuid references public.assets(id) on delete set null,
  site_id          uuid references public.sites(id) on delete set null,
  title            text not null,
  kind             text not null default 'condition'
                     check (kind in ('safety','condition','integrity','regulatory','environmental')),
  status           text not null default 'scheduled'
                     check (status in ('scheduled','due','in_progress','completed','overdue')),
  inspector_id     uuid references public.profiles(id) on delete set null,
  scheduled_date   date not null,
  completed_date   date,
  findings         text,
  notes            text,
  checklist_results jsonb,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

create trigger inspections_updated_at
  before update on public.inspections
  for each row execute function public.set_updated_at();

create index insp_org_idx    on public.inspections (org_id);
create index insp_status_idx on public.inspections (org_id, status);
create index insp_date_idx   on public.inspections (org_id, scheduled_date);

alter table public.inspections enable row level security;
create policy insp_sel on public.inspections for select using (org_id = (auth.jwt()->>'org_id')::uuid);
create policy insp_ins on public.inspections for insert with check (org_id = (auth.jwt()->>'org_id')::uuid);
create policy insp_upd on public.inspections for update using (org_id = (auth.jwt()->>'org_id')::uuid);

-- ── Reports ───────────────────────────────────────────────────────────────────

create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  title            text not null,
  kind             text not null,
  status           text not null default 'pending'
                     check (status in ('pending','generating','ready','failed')),
  format           text not null default 'pdf'
                     check (format in ('pdf','xlsx','csv')),
  params           jsonb,
  storage_path     text,
  file_size_bytes  bigint,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz default now(),
  completed_at     timestamptz
);

create index rpt_org_idx on public.reports (org_id, created_at desc);

alter table public.reports enable row level security;
create policy rpt_sel on public.reports for select using (org_id = (auth.jwt()->>'org_id')::uuid);
create policy rpt_ins on public.reports for insert with check (org_id = (auth.jwt()->>'org_id')::uuid);
create policy rpt_upd on public.reports for update using (org_id = (auth.jwt()->>'org_id')::uuid);

-- ── Approvals (scaffold — UI comes in Phase 4) ────────────────────────────────

create table public.approvals (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  entity_type  text not null,  -- 'work_order' | 'compliance_licence' | 'pm_task'
  entity_id    uuid not null,
  kind         text not null,  -- 'wo_closure' | 'licence_renewal' | 'pm_signoff'
  status       text not null default 'pending'
                 check (status in ('pending','approved','rejected')),
  requester_id uuid references public.profiles(id) on delete set null,
  approver_id  uuid references public.profiles(id) on delete set null,
  notes        text,
  decided_at   timestamptz,
  created_at   timestamptz default now()
);

alter table public.approvals enable row level security;
create policy apr_sel on public.approvals for select using (org_id = (auth.jwt()->>'org_id')::uuid);
create policy apr_ins on public.approvals for insert with check (org_id = (auth.jwt()->>'org_id')::uuid);
create policy apr_upd on public.approvals for update using (org_id = (auth.jwt()->>'org_id')::uuid);

-- ── Function: generate licence expiry notifications ───────────────────────────
-- Fires at 90 / 30 / 7 days before expiry for each owner/ops_manager in the org.
-- Idempotent: skips if a notification for the same licence+user was sent today.

create or replace function public.check_licence_expiry(p_org_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lic    record;
  v_days   int;
  v_count  int := 0;
begin
  for v_lic in
    select cl.id, cl.org_id, cl.name, cl.expiry_date, m.user_id
    from   public.compliance_licences cl
    join   public.memberships m on m.org_id = cl.org_id and m.status = 'active'
    where  cl.deleted_at is null
      and  cl.expiry_date >= current_date
      and  cl.expiry_date <= current_date + interval '90 days'
      and  m.role_key in ('owner','ops_manager')
      and  (p_org_id is null or cl.org_id = p_org_id)
  loop
    v_days := v_lic.expiry_date - current_date;
    if v_days not in (90, 30, 7) then continue; end if;

    if exists (
      select 1 from public.notifications n
      where  n.entity_id = v_lic.id
        and  n.user_id   = v_lic.user_id
        and  n.kind      = 'licence_expiry'
        and  n.created_at::date = current_date
    ) then continue; end if;

    insert into public.notifications (org_id, user_id, kind, title, body, entity_type, entity_id)
    values (
      v_lic.org_id,
      v_lic.user_id,
      'licence_expiry',
      'Licence expiring in ' || v_days || ' days: ' || v_lic.name,
      'Expires ' || to_char(v_lic.expiry_date, 'DD Mon YYYY') || '. Renew to maintain compliance.',
      'compliance_licence',
      v_lic.id
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- pg_cron hook (run as superuser once after enabling extension):
-- select cron.schedule('check-licence-expiry', '0 7 * * *', 'select public.check_licence_expiry()');

-- ── Grants ────────────────────────────────────────────────────────────────────

grant select, insert, update, delete on public.compliance_licences to authenticated;
grant select, insert, update, delete on public.inspections           to authenticated;
grant select, insert, update         on public.reports               to authenticated;
grant select, insert, update         on public.approvals             to authenticated;
grant execute on function public.check_licence_expiry(uuid)          to authenticated;
grant execute on function public.licence_status(date)                to authenticated;
