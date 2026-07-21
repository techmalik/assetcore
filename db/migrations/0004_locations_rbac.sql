-- ============================================================================
-- 0004_locations_rbac
-- Location -> Site hierarchy, per-member scope (sites and/or locations) with
-- enforced row-level filtering, per-member extra capability grants, and the
-- roles alignment (System Admin label + new read-only Auditor role).
--
-- Enforcement model: the API resolves each caller's effective site-id set at
-- token-issue time (login/refresh) and passes it into every request via the
-- app.site_ids GUC; current_site_ids() reads it and the RLS policies below
-- restrict every site-bearing table to that set. NULL (empty GUC) = all sites
-- (System Admin / senior staff). ownerPool (admin, cron) bypasses RLS entirely.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- locations (org -> many locations; each site belongs to a location)
-- ----------------------------------------------------------------------------
create table if not exists public.locations (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  name       text not null,
  code       text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (org_id, name)
);
create index if not exists locations_org_idx on public.locations (org_id);

alter table public.locations enable row level security;
create policy locations_all on public.locations for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
grant select, insert, update, delete on public.locations to assetcore_app;

alter table public.sites add column if not exists location_id uuid references public.locations(id) on delete set null;
create index if not exists sites_location_idx on public.sites (location_id);

-- Backfill: one location per distinct existing region, then link each site.
do $$
declare r record;
begin
  for r in select distinct org_id, region from public.sites
           where region is not null and btrim(region) <> '' loop
    insert into public.locations (org_id, name)
    values (r.org_id, r.region)
    on conflict (org_id, name) do nothing;
  end loop;
  update public.sites s
  set location_id = l.id
  from public.locations l
  where l.org_id = s.org_id and l.name = s.region and s.location_id is null;
end $$;

-- ----------------------------------------------------------------------------
-- membership scope + per-user extra capability grants
-- ----------------------------------------------------------------------------
alter table public.memberships
  add column if not exists location_scope uuid[],
  add column if not exists extra_caps      text[] not null default '{}';

-- ----------------------------------------------------------------------------
-- roles: relabel owner -> "System Admin", add read-only "Auditor"
-- ----------------------------------------------------------------------------
update public.roles set label = 'System Admin' where key = 'owner';
insert into public.roles (key, label, description, rank) values
  ('auditor', 'Auditor', 'Read-only access with full audit and compliance visibility.', 30)
  on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- current_site_ids(): effective site scope for the request, from app.site_ids
-- GUC (comma-joined uuids). Empty/unset => NULL => all sites.
-- ----------------------------------------------------------------------------
create or replace function public.current_site_ids()
returns uuid[] language sql stable as $$
  select case
    when nullif(current_setting('app.site_ids', true), '') is null then null
    else string_to_array(current_setting('app.site_ids', true), ',')::uuid[]
  end;
$$;
grant execute on function public.current_site_ids() to assetcore_app;

-- ----------------------------------------------------------------------------
-- Extend every site-bearing tenant table's RLS with the scope predicate.
-- Rows with a NULL site_id are visible only to all-scope callers.
-- ----------------------------------------------------------------------------
alter policy assets_all on public.assets
  using (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())))
  with check (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())));

alter policy work_orders_all on public.work_orders
  using (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())))
  with check (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())));

alter policy insp_sel on public.inspections
  using (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())));
alter policy insp_ins on public.inspections
  with check (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())));
alter policy insp_upd on public.inspections
  using (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())));

alter policy pm_schedules_sel on public.pm_schedules
  using (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())));
alter policy pm_schedules_ins on public.pm_schedules
  with check (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())));
alter policy pm_schedules_upd on public.pm_schedules
  using (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())));

alter policy pm_tasks_sel on public.pm_tasks
  using (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())));
alter policy pm_tasks_ins on public.pm_tasks
  with check (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())));
alter policy pm_tasks_upd on public.pm_tasks
  using (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())));

alter policy cl_sel on public.compliance_licences
  using (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())));
alter policy cl_ins on public.compliance_licences
  with check (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())));
alter policy cl_upd on public.compliance_licences
  using (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())));

alter policy devices_sel on public.devices
  using (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())));
alter policy devices_ins on public.devices
  with check (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())));
alter policy devices_upd on public.devices
  using (org_id = current_org_id() and (current_site_ids() is null or site_id = any(current_site_ids())));
