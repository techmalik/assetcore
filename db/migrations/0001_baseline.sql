-- ============================================================================
-- AssetCore — 0001_baseline
-- Fresh baseline for the on-prem pivot (plain PostgreSQL, no Supabase).
-- Ports supabase/migrations 0001-0007 (+ the pre-pivot 0004 RLS fix) with:
--   - auth.users + public.profiles merged into a single public.users table
--   - a new auth_tokens table (refresh/reset/invite — opaque, hashed, DB-backed)
--   - current_org_id()/current_user_id()/current_role_key() read SET LOCAL
--     session GUCs instead of auth.jwt(); every policy rewritten against them
--   - custom_access_token_hook + supabase_auth_admin/service_role/anon/
--     authenticated role machinery dropped; assetcore_app replaces `authenticated`
--   - a new licence_info table
-- No production data exists anywhere, so this is a clean squash, not a migration
-- of live data.
-- ============================================================================

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ----------------------------------------------------------------------------
-- Shared helpers
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- Per-request tenant context, set via `SET LOCAL` inside a transaction by
-- apps/api's withOrgContext() (db.ts). `true` = missing_ok, so a raw session
-- with no SET LOCAL at all (e.g. a bare psql connection) reads back NULL.
create or replace function public.current_org_id()
returns uuid language sql stable as $$
  select nullif(current_setting('app.org_id', true), '')::uuid;
$$;

create or replace function public.current_user_id()
returns uuid language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid;
$$;

create or replace function public.current_role_key()
returns text language sql stable as $$
  select nullif(current_setting('app.role_key', true), '');
$$;

-- ----------------------------------------------------------------------------
-- roles (static reference)
-- ----------------------------------------------------------------------------
create table public.roles (
  key         text primary key,
  label       text not null,
  description text,
  rank        int  not null default 0
);

insert into public.roles (key, label, description, rank) values
  ('owner',          'Org Owner / Admin',   'Full access incl. org settings, users, billing.', 100),
  ('ops_manager',    'Operations Manager',  'Assigns and tracks work orders, handles escalations.', 80),
  ('maint_engineer', 'Maintenance Engineer','Works schedules and checklists, completes jobs.', 60),
  ('field_tech',     'Field Technician',    'Mobile/on-site: updates work orders, adds readings/photos.', 40),
  ('hse_officer',    'HSE Officer',         'Runs inspections and compliance/licence renewals.', 50),
  ('viewer',         'Executive / Viewer',  'Read-only dashboards, reports, audit access.', 20);

-- ----------------------------------------------------------------------------
-- organizations (tenant root)
-- ----------------------------------------------------------------------------
create table public.organizations (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  short_name     text,
  industry       text,
  region         text,
  plan           text not null default 'trial',
  billing_status text not null default 'trial',
  settings       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  deleted_at     timestamptz
);

-- ----------------------------------------------------------------------------
-- users — merges auth.users + public.profiles. We own auth now: argon2id
-- password hashes, no GoTrue, no handle_new_user trigger.
-- ----------------------------------------------------------------------------
create table public.users (
  id                    uuid primary key default gen_random_uuid(),
  email                 citext unique not null,
  password_hash         text not null,
  full_name             text not null default '',
  phone                 text,
  avatar_url            text,
  status                text not null default 'active' check (status in ('active','disabled')),
  must_change_password  boolean not null default false,
  created_at            timestamptz not null default now()
);

-- auth_tokens — opaque, hashed, single-use tokens for refresh/reset/invite.
-- Never store the raw token; only sha256(token) in token_hash.
create table public.auth_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  kind       text not null check (kind in ('refresh','reset','invite')),
  token_hash text not null,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);
create index auth_tokens_hash_idx on public.auth_tokens (token_hash);
create index auth_tokens_user_kind_idx on public.auth_tokens (user_id, kind);

-- ----------------------------------------------------------------------------
-- sites
-- ----------------------------------------------------------------------------
create table public.sites (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  name       text not null,
  code       text,
  lat        double precision,
  lng        double precision,
  region     text,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index sites_org_idx on public.sites (org_id);

-- ----------------------------------------------------------------------------
-- memberships (user ↔ org ↔ role, with optional site scoping)
-- ----------------------------------------------------------------------------
create table public.memberships (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references public.users(id) on delete cascade,
  role_key   text not null references public.roles(key),
  site_scope uuid[],                       -- null = all sites
  status     text not null default 'active',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index memberships_user_idx on public.memberships (user_id);
create index memberships_org_idx  on public.memberships (org_id);

-- ----------------------------------------------------------------------------
-- asset_categories
-- ----------------------------------------------------------------------------
create table public.asset_categories (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  name       text not null,
  code       text,
  created_at timestamptz not null default now()
);
create index asset_categories_org_idx on public.asset_categories (org_id);

-- ----------------------------------------------------------------------------
-- assets
-- ----------------------------------------------------------------------------
create table public.assets (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  site_id            uuid references public.sites(id) on delete set null,
  ain                text not null,        -- asset identifier number (unique per org)
  name               text not null,
  category_id        uuid references public.asset_categories(id) on delete set null,
  status             text not null default 'operational'
                       check (status in ('operational','attention','critical','offline')),
  health_score       int,
  lat                double precision,
  lng                double precision,
  specs              jsonb not null default '{}'::jsonb,
  purchase_value_cents bigint,
  nbv_cents          bigint,
  parent_asset_id    uuid references public.assets(id) on delete set null,
  photos             jsonb not null default '[]'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  unique (org_id, ain)
);
create index assets_org_site_idx   on public.assets (org_id, site_id);
create index assets_org_status_idx on public.assets (org_id, status);
create trigger assets_set_updated_at before update on public.assets
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- work_orders
-- ----------------------------------------------------------------------------
create table public.work_orders (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  site_id     uuid references public.sites(id) on delete set null,
  asset_id    uuid references public.assets(id) on delete set null,
  ref         text not null,               -- e.g. WO-2025-0847 (unique per org)
  title       text not null,
  description text,
  type        text not null default 'corrective'
                check (type in ('corrective','preventive','inspection','emergency')),
  status      text not null default 'new'
                check (status in ('new','assigned','in_progress','awaiting_parts','inspection','closed')),
  priority    text not null default 'medium'
                check (priority in ('low','medium','high','critical')),
  assignee_id uuid references public.users(id) on delete set null,
  created_by  uuid references public.users(id) on delete set null,
  sla_due     timestamptz,
  parts       jsonb not null default '[]'::jsonb,
  cost_cents  bigint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (org_id, ref)
);
create index work_orders_org_status_idx on public.work_orders (org_id, status);
create index work_orders_org_asset_idx  on public.work_orders (org_id, asset_id);
create trigger work_orders_set_updated_at before update on public.work_orders
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- work_order_activity (comments / status changes / attachments)
-- ----------------------------------------------------------------------------
create table public.work_order_activity (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  user_id       uuid references public.users(id) on delete set null,
  kind          text not null default 'comment'
                  check (kind in ('comment','status_change','assignment','attachment')),
  body          text,
  attachments   jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);
create index wo_activity_wo_idx on public.work_order_activity (work_order_id);

-- ----------------------------------------------------------------------------
-- audit_log (append-only, per-org)
-- ----------------------------------------------------------------------------
create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  actor_id    uuid references public.users(id) on delete set null,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log (org_id, created_at desc);

-- ----------------------------------------------------------------------------
-- pm_schedules / pm_tasks
-- ----------------------------------------------------------------------------
create table public.pm_schedules (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  asset_id         uuid references public.assets(id) on delete set null,
  site_id          uuid references public.sites(id) on delete set null,
  title            text not null,
  description      text,
  frequency        text not null check (frequency in ('daily','weekly','monthly','quarterly','semi_annual','annual')),
  estimated_hours  numeric(5,1),
  next_due         date not null,
  assignee_id      uuid references public.users(id) on delete set null,
  active           boolean not null default true,
  created_at       timestamptz default now(),
  deleted_at       timestamptz
);
create index pm_schedules_org_idx  on public.pm_schedules (org_id);
create index pm_schedules_due_idx  on public.pm_schedules (org_id, next_due) where deleted_at is null;

create table public.pm_tasks (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  schedule_id         uuid references public.pm_schedules(id) on delete set null,
  asset_id            uuid references public.assets(id) on delete set null,
  site_id             uuid references public.sites(id) on delete set null,
  title               text not null,
  description         text,
  status              text not null default 'pending'
                        check (status in ('pending','in_progress','completed','overdue','skipped')),
  due_date            date not null,
  assignee_id         uuid references public.users(id) on delete set null,
  completed_at        timestamptz,
  notes               text,
  checklist_results   jsonb,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);
create index pm_tasks_org_idx      on public.pm_tasks (org_id);
create index pm_tasks_status_idx   on public.pm_tasks (org_id, status);
create index pm_tasks_due_idx      on public.pm_tasks (org_id, due_date);
create index pm_tasks_schedule_idx on public.pm_tasks (schedule_id);
create trigger pm_tasks_set_updated_at
  before update on public.pm_tasks
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- notifications / notification_preferences
-- Realtime → 30s polling (Phase 1, frontend only). No supabase_realtime
-- publication in plain Postgres.
-- ----------------------------------------------------------------------------
create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  kind         text not null,  -- wo_assigned|wo_transition|wo_comment|pm_due|pm_overdue|licence_expiry|system
  title        text not null,
  body         text,
  entity_type  text,           -- 'work_order'|'pm_task'|'pm_schedule'|'compliance_licence'
  entity_id    uuid,
  read         boolean not null default false,
  created_at   timestamptz default now()
);
create index notifications_user_idx on public.notifications (user_id, read, created_at desc);
create index notifications_org_idx  on public.notifications (org_id, created_at desc);

create table public.notification_preferences (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references public.organizations(id) on delete cascade,
  user_id  uuid not null references public.users(id) on delete cascade,
  kind     text not null,
  in_app   boolean not null default true,
  email    boolean not null default false,
  unique (org_id, user_id, kind)
);

-- ----------------------------------------------------------------------------
-- Trigger: notify on WO activity
-- ----------------------------------------------------------------------------
create or replace function public.notify_wo_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo       record;
  v_title    text;
  v_body     text;
  v_kind     text;
begin
  select * into v_wo from public.work_orders where id = new.work_order_id;
  if not found or v_wo.assignee_id is null then return new; end if;
  if v_wo.assignee_id = new.user_id then return new; end if;

  if new.kind = 'status_change' then
    v_kind  := 'wo_transition';
    v_title := 'Work order updated: ' || coalesce(v_wo.ref, 'unknown');
    v_body  := new.body;
  elsif new.kind = 'comment' then
    v_kind  := 'wo_comment';
    v_title := 'New comment on ' || coalesce(v_wo.ref, 'unknown');
    v_body  := left(new.body, 120);
  else
    return new;
  end if;

  insert into public.notifications (org_id, user_id, kind, title, body, entity_type, entity_id)
  values (v_wo.org_id, v_wo.assignee_id, v_kind, v_title, v_body, 'work_order', v_wo.id);

  return new;
end;
$$;

create trigger trg_notify_wo_activity
  after insert on public.work_order_activity
  for each row execute function public.notify_wo_activity();

-- ----------------------------------------------------------------------------
-- Function: generate PM tasks for due schedules (node-cron: 06:00 daily)
-- ----------------------------------------------------------------------------
create or replace function public.generate_pm_tasks(p_org_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule  record;
  v_count     int := 0;
  v_next_due  date;
begin
  for v_schedule in
    select s.*
    from public.pm_schedules s
    where s.active = true
      and s.deleted_at is null
      and s.next_due <= current_date + interval '7 days'
      and (p_org_id is null or s.org_id = p_org_id)
      and not exists (
        select 1 from public.pm_tasks t
        where t.schedule_id = s.id
          and t.status in ('pending','in_progress')
      )
  loop
    insert into public.pm_tasks (
      org_id, schedule_id, asset_id, site_id,
      title, description, status, due_date, assignee_id
    ) values (
      v_schedule.org_id,
      v_schedule.id,
      v_schedule.asset_id,
      v_schedule.site_id,
      v_schedule.title,
      v_schedule.description,
      'pending',
      v_schedule.next_due,
      v_schedule.assignee_id
    );

    v_next_due := case v_schedule.frequency
      when 'daily'       then v_schedule.next_due + interval '1 day'
      when 'weekly'      then v_schedule.next_due + interval '1 week'
      when 'monthly'     then v_schedule.next_due + interval '1 month'
      when 'quarterly'   then v_schedule.next_due + interval '3 months'
      when 'semi_annual' then v_schedule.next_due + interval '6 months'
      when 'annual'      then v_schedule.next_due + interval '1 year'
      else v_schedule.next_due + interval '1 month'
    end;

    update public.pm_schedules
    set next_due = v_next_due
    where id = v_schedule.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- Function: mark overdue PM tasks (node-cron: 00:05 daily)
-- ----------------------------------------------------------------------------
create or replace function public.mark_overdue_pm_tasks()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  update public.pm_tasks
  set status = 'overdue', updated_at = now()
  where status = 'pending'
    and due_date < current_date;

  get diagnostics v_count = row_count;

  insert into public.notifications (org_id, user_id, kind, title, body, entity_type, entity_id)
  select
    t.org_id,
    t.assignee_id,
    'pm_overdue',
    'PM task overdue: ' || t.title,
    'Due ' || to_char(t.due_date, 'DD Mon YYYY') || ' — please complete or reschedule.',
    'pm_task',
    t.id
  from public.pm_tasks t
  where t.status = 'overdue'
    and t.assignee_id is not null
    and t.updated_at >= now() - interval '1 minute'
    and not exists (
      select 1 from public.notifications n
      where n.entity_id = t.id and n.kind = 'pm_overdue'
        and n.created_at >= now() - interval '1 day'
    );

  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- Regulatory Authorities (global reference — no RLS-relevant org_id)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- Compliance Licences
-- ----------------------------------------------------------------------------
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
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now(),
  deleted_at      timestamptz
);

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

-- ----------------------------------------------------------------------------
-- Inspections
-- ----------------------------------------------------------------------------
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
  inspector_id     uuid references public.users(id) on delete set null,
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

-- ----------------------------------------------------------------------------
-- Reports
-- ----------------------------------------------------------------------------
create table public.reports (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  title            text not null,
  kind             text not null,
  status           text not null default 'pending'
                     check (status in ('pending','generating','ready','failed')),
  format           text not null default 'xlsx'
                     check (format in ('csv','xlsx')),
  params           jsonb,
  storage_path     text,
  file_size_bytes  bigint,
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz default now(),
  completed_at     timestamptz
);
create index rpt_org_idx on public.reports (org_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Approvals (scaffold)
-- ----------------------------------------------------------------------------
create table public.approvals (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  entity_type  text not null,  -- 'work_order' | 'compliance_licence' | 'pm_task'
  entity_id    uuid not null,
  kind         text not null,  -- 'wo_closure' | 'licence_renewal' | 'pm_signoff'
  status       text not null default 'pending'
                 check (status in ('pending','approved','rejected')),
  requester_id uuid references public.users(id) on delete set null,
  approver_id  uuid references public.users(id) on delete set null,
  notes        text,
  decided_at   timestamptz,
  created_at   timestamptz default now()
);

-- ----------------------------------------------------------------------------
-- Function: licence expiry notifications (node-cron: 07:00 daily)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- Devices
-- ----------------------------------------------------------------------------
create table public.devices (
  id               uuid default gen_random_uuid() primary key,
  org_id           uuid not null references public.organizations(id),
  asset_id         uuid references public.assets(id) on delete set null,
  site_id          uuid references public.sites(id) on delete set null,
  serial_number    text,
  name             text not null,
  kind             text not null default 'sensor',   -- sensor|gateway|meter|camera|plc
  protocol         text not null default 'mqtt',     -- mqtt|modbus|http|opc-ua
  status           text not null default 'unprovisioned', -- online|offline|error|unprovisioned
  last_seen_at     timestamptz,
  firmware_version text,
  ip_address       text,
  config           jsonb not null default '{}',
  created_at       timestamptz default now(),
  deleted_at       timestamptz
);
create index on public.devices (org_id, status);
create index on public.devices (org_id, asset_id);

-- ----------------------------------------------------------------------------
-- Telemetry readings (partitioned by month/year)
-- ----------------------------------------------------------------------------
create table public.telemetry_readings (
  id           uuid    default gen_random_uuid(),
  org_id       uuid    not null,
  device_id    uuid    not null references public.devices(id) on delete cascade,
  reading_type text    not null,   -- pressure|temperature|flow_rate|vibration|level|...
  value        numeric not null,
  unit         text    not null,
  quality      int     not null default 100,   -- 0–100 data quality score
  recorded_at  timestamptz not null default now(),
  primary key (id, recorded_at)
) partition by range (recorded_at);

create table public.telemetry_readings_2026
  partition of public.telemetry_readings
  for values from ('2026-01-01') to ('2027-01-01');

create table public.telemetry_readings_2027
  partition of public.telemetry_readings
  for values from ('2027-01-01') to ('2028-01-01');

create index on public.telemetry_readings_2026 (org_id, device_id, recorded_at desc);
create index on public.telemetry_readings_2027 (org_id, device_id, recorded_at desc);

-- ----------------------------------------------------------------------------
-- Integrations
-- ----------------------------------------------------------------------------
create table public.integrations (
  id               uuid default gen_random_uuid() primary key,
  org_id           uuid not null references public.organizations(id),
  kind             text not null,   -- sap|termii|scada|azure_iot|...
  label            text,
  enabled          boolean not null default false,
  config           jsonb   not null default '{}',
  last_synced_at   timestamptz,
  last_sync_status text,            -- ok|error
  last_sync_error  text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  unique (org_id, kind)
);

-- ----------------------------------------------------------------------------
-- SMS log (outbound Termii messages)
-- ----------------------------------------------------------------------------
create table public.sms_log (
  id            uuid default gen_random_uuid() primary key,
  org_id        uuid not null references public.organizations(id),
  to_number     text not null,
  message       text not null,
  status        text not null default 'pending',  -- pending|sent|failed
  provider_ref  text,
  error_message text,
  sent_at       timestamptz,
  created_at    timestamptz default now()
);

-- ============================================================================
-- Platform backoffice tables — reached exclusively through apps/api's
-- ownerPool (mirrors the old service-role gateway pattern). RLS policies below
-- are a defense-in-depth floor, not the primary gate.
-- ============================================================================

create table public.platform_admins (
  user_id    uuid primary key references public.users(id) on delete cascade,
  role       text not null default 'support'
               check (role in ('superadmin','admin','support','billing')),
  full_name  text not null default '',
  status     text not null default 'active'
               check (status in ('active','disabled')),
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create or replace function public.is_platform_admin(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.platform_admins
    where user_id = uid and status = 'active'
  );
$$;

create table public.platform_audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.users(id) on delete set null,
  action      text not null,
  target_type text not null
                check (target_type in ('org','user','invoice','admin','impersonation','note')),
  target_id   uuid,
  org_id      uuid references public.organizations(id) on delete set null,
  before      jsonb,
  after       jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);
create index platform_audit_actor_idx  on public.platform_audit_log (actor_id, created_at desc);
create index platform_audit_target_idx on public.platform_audit_log (target_type, target_id);
create index platform_audit_org_idx    on public.platform_audit_log (org_id, created_at desc);

create table public.billing_invoices (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  number       text not null unique,                 -- e.g. INV-2026-0007
  period_start date,
  period_end   date,
  amount_cents bigint not null default 0,
  currency     text not null default 'NGN',
  status       text not null default 'draft'
                 check (status in ('draft','sent','paid','overdue','void')),
  po_number    text,
  issued_at    timestamptz,
  due_at       timestamptz,
  paid_at      timestamptz,
  notes        text,
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index billing_invoices_org_idx    on public.billing_invoices (org_id, created_at desc);
create index billing_invoices_status_idx on public.billing_invoices (status);
create trigger billing_invoices_set_updated_at before update on public.billing_invoices
  for each row execute function public.set_updated_at();

create table public.org_notes (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  author_id  uuid references public.users(id) on delete set null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index org_notes_org_idx on public.org_notes (org_id, created_at desc);

create table public.impersonation_grants (
  id         uuid primary key default gen_random_uuid(),
  admin_id   uuid not null references public.users(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  reason     text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index impersonation_admin_idx on public.impersonation_grants (admin_id, created_at desc);
create index impersonation_org_idx   on public.impersonation_grants (org_id, created_at desc);

-- ============================================================================
-- licence_info — new. Single-row-per-instance licensing config, surfaced in
-- Settings (Phase 3) and enforced SOFT (banners only, never a hard lock).
-- Writes only via /api/admin + /api/org handlers on the owner pool.
-- ============================================================================
create table public.licence_info (
  id                     uuid primary key default gen_random_uuid(),
  licensed_to            text not null,
  contract_ref           text,
  issued_at              date,
  expires_at             date,
  maintenance_expires_at date,
  annual_fee_cents       bigint,
  currency               text not null default 'NGN',
  seats                  int,
  notes                  text,
  updated_at             timestamptz not null default now()
);
create trigger licence_info_set_updated_at before update on public.licence_info
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Row-Level Security
-- ============================================================================
alter table public.roles                  enable row level security;
alter table public.organizations          enable row level security;
alter table public.users                  enable row level security;
alter table public.sites                  enable row level security;
alter table public.memberships            enable row level security;
alter table public.asset_categories       enable row level security;
alter table public.assets                 enable row level security;
alter table public.work_orders            enable row level security;
alter table public.work_order_activity    enable row level security;
alter table public.audit_log              enable row level security;
alter table public.pm_schedules           enable row level security;
alter table public.pm_tasks               enable row level security;
alter table public.notifications          enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.regulatory_authorities enable row level security;
alter table public.compliance_licences    enable row level security;
alter table public.inspections            enable row level security;
alter table public.reports                enable row level security;
alter table public.approvals              enable row level security;
alter table public.devices                enable row level security;
alter table public.telemetry_readings      enable row level security;
alter table public.telemetry_readings_2026 enable row level security;
alter table public.telemetry_readings_2027 enable row level security;
alter table public.integrations           enable row level security;
alter table public.sms_log                enable row level security;
alter table public.auth_tokens            enable row level security;
alter table public.platform_admins        enable row level security;
alter table public.platform_audit_log     enable row level security;
alter table public.billing_invoices       enable row level security;
alter table public.org_notes              enable row level security;
alter table public.impersonation_grants   enable row level security;
alter table public.licence_info           enable row level security;

-- roles: any authenticated user may read the reference list.
create policy roles_read on public.roles for select using (true);

-- organizations: members can read their org; only the owner role can update it.
create policy org_select on public.organizations for select
  using (id = current_org_id());
create policy org_update on public.organizations for update
  using (id = current_org_id() and current_role_key() = 'owner')
  with check (id = current_org_id() and current_role_key() = 'owner');

-- users: self, plus anyone sharing an org with you (for assignee names).
-- NOTE: login (pre-session, no current_user_id() yet) reads via apps/api's
-- ownerPool, which bypasses RLS entirely — these policies gate the RLS-pool
-- reads that happen once a session is established.
create policy users_self on public.users for select
  using (id = current_user_id());
create policy users_same_org on public.users for select
  using (exists (
    select 1 from public.memberships m1
    join public.memberships m2 on m1.org_id = m2.org_id
    where m1.user_id = current_user_id() and m2.user_id = users.id
  ));
create policy users_update_self on public.users for update
  using (id = current_user_id());

-- memberships: members can read memberships within their org.
create policy memberships_select on public.memberships for select
  using (org_id = current_org_id());

-- Standard tenant tables: full access scoped to the caller's org.
create policy sites_all on public.sites for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy categories_all on public.asset_categories for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy assets_all on public.assets for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy work_orders_all on public.work_orders for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy wo_activity_all on public.work_order_activity for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());

-- audit_log: append-only — SELECT + INSERT scoped to org, no UPDATE/DELETE policy.
create policy audit_select on public.audit_log for select
  using (org_id = current_org_id());
create policy audit_insert on public.audit_log for insert
  with check (org_id = current_org_id());

create policy pm_schedules_sel on public.pm_schedules for select using (org_id = current_org_id());
create policy pm_schedules_ins on public.pm_schedules for insert with check (org_id = current_org_id());
create policy pm_schedules_upd on public.pm_schedules for update using (org_id = current_org_id());

create policy pm_tasks_sel on public.pm_tasks for select using (org_id = current_org_id());
create policy pm_tasks_ins on public.pm_tasks for insert with check (org_id = current_org_id());
create policy pm_tasks_upd on public.pm_tasks for update using (org_id = current_org_id());

-- notifications: users only see/act on their own.
create policy notifications_sel on public.notifications for select
  using (user_id = current_user_id());
create policy notifications_upd on public.notifications for update
  using (user_id = current_user_id());
create policy notifications_ins on public.notifications for insert
  with check (org_id = current_org_id());

create policy notif_prefs_sel on public.notification_preferences for select using (user_id = current_user_id());
create policy notif_prefs_ins on public.notification_preferences for insert with check (user_id = current_user_id());
create policy notif_prefs_upd on public.notification_preferences for update using (user_id = current_user_id());

-- regulatory_authorities: global reference data, readable by anyone, writable
-- by no one via the RLS pool.
create policy ra_sel on public.regulatory_authorities for select using (true);

create policy cl_sel on public.compliance_licences for select using (org_id = current_org_id());
create policy cl_ins on public.compliance_licences for insert with check (org_id = current_org_id());
create policy cl_upd on public.compliance_licences for update using (org_id = current_org_id());

create policy insp_sel on public.inspections for select using (org_id = current_org_id());
create policy insp_ins on public.inspections for insert with check (org_id = current_org_id());
create policy insp_upd on public.inspections for update using (org_id = current_org_id());

create policy rpt_sel on public.reports for select using (org_id = current_org_id());
create policy rpt_ins on public.reports for insert with check (org_id = current_org_id());
create policy rpt_upd on public.reports for update using (org_id = current_org_id());

create policy apr_sel on public.approvals for select using (org_id = current_org_id());
create policy apr_ins on public.approvals for insert with check (org_id = current_org_id());
create policy apr_upd on public.approvals for update using (org_id = current_org_id());

create policy devices_sel on public.devices for select using (org_id = current_org_id());
create policy devices_ins on public.devices for insert with check (org_id = current_org_id());
create policy devices_upd on public.devices for update using (org_id = current_org_id());

create policy telemetry_sel on public.telemetry_readings for select using (org_id = current_org_id());
create policy telemetry_ins on public.telemetry_readings for insert with check (org_id = current_org_id());

create policy integrations_sel on public.integrations for select using (org_id = current_org_id());
create policy integrations_ins on public.integrations for insert with check (org_id = current_org_id());
create policy integrations_upd on public.integrations for update using (org_id = current_org_id());

create policy sms_log_sel on public.sms_log for select using (org_id = current_org_id());

-- auth_tokens: normal request path (RLS pool) may only ever see its own
-- tokens; token issuance/verification happens via ownerPool in apps/api/auth.
create policy auth_tokens_self on public.auth_tokens for select
  using (user_id = current_user_id());

-- platform_admins: a user may read ONLY their own row (self "am I an admin?"
-- check). No write policy on the RLS pool → writes only via ownerPool.
create policy platform_admins_self on public.platform_admins for select
  using (user_id = current_user_id());

-- platform_audit_log: readable only by active platform admins.
create policy platform_audit_read on public.platform_audit_log for select
  using (public.is_platform_admin(current_user_id()));

-- billing_invoices: tenant members may read their own org's invoices; admin
-- CRUD happens via ownerPool.
create policy billing_invoices_org_read on public.billing_invoices for select
  using (org_id = current_org_id());

-- org_notes: no RLS-pool policy at all (admin-only via ownerPool); RLS on
-- with no policy = deny.

create policy impersonation_self_read on public.impersonation_grants for select
  using (admin_id = current_user_id());

-- licence_info: readable by any active member of any org; writes via
-- ownerPool only (no insert/update policy on the RLS pool).
create policy licence_info_read on public.licence_info for select
  using (exists (
    select 1 from public.memberships m
    where m.user_id = current_user_id() and m.status = 'active'
  ));

-- ============================================================================
-- assetcore_app — the API's normal, RLS-enforced connection role. Non-owner,
-- non-superuser, so RLS applies even against API bugs. Table grants mirror
-- the old `authenticated` PostgREST role's grants; change the password in
-- production (see deploy/.env.deploy.example).
-- ============================================================================
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'assetcore_app') then
    create role assetcore_app login password 'assetcore_app';
  end if;
end
$$;

grant usage on schema public to assetcore_app;

grant select on public.roles to assetcore_app;
grant select, update on public.organizations to assetcore_app;
grant select, update on public.users to assetcore_app;
grant select on public.memberships to assetcore_app;
grant select, insert, update, delete on public.sites to assetcore_app;
grant select, insert, update, delete on public.asset_categories to assetcore_app;
grant select, insert, update, delete on public.assets to assetcore_app;
grant select, insert, update, delete on public.work_orders to assetcore_app;
grant select, insert, update, delete on public.work_order_activity to assetcore_app;
grant select, insert on public.audit_log to assetcore_app;
grant select, insert, update, delete on public.pm_schedules to assetcore_app;
grant select, insert, update, delete on public.pm_tasks to assetcore_app;
grant select, insert, update on public.notifications to assetcore_app;
grant select, insert, update, delete on public.notification_preferences to assetcore_app;
grant select on public.regulatory_authorities to assetcore_app;
grant select, insert, update, delete on public.compliance_licences to assetcore_app;
grant select, insert, update, delete on public.inspections to assetcore_app;
grant select, insert, update on public.reports to assetcore_app;
grant select, insert, update on public.approvals to assetcore_app;
grant select, insert, update on public.devices to assetcore_app;
grant select, insert on public.telemetry_readings to assetcore_app;
grant select, insert on public.telemetry_readings_2026 to assetcore_app;
grant select, insert on public.telemetry_readings_2027 to assetcore_app;
grant select, insert, update on public.integrations to assetcore_app;
grant select on public.sms_log to assetcore_app;
grant select on public.auth_tokens to assetcore_app;
grant select on public.platform_admins to assetcore_app;
grant select on public.platform_audit_log to assetcore_app;
grant select on public.billing_invoices to assetcore_app;
grant select on public.impersonation_grants to assetcore_app;
grant select on public.licence_info to assetcore_app;

grant execute on function public.generate_pm_tasks(uuid)   to assetcore_app;
grant execute on function public.mark_overdue_pm_tasks()   to assetcore_app;
grant execute on function public.check_licence_expiry(uuid) to assetcore_app;
grant execute on function public.licence_status(date)      to assetcore_app;
grant execute on function public.is_platform_admin(uuid)   to assetcore_app;
