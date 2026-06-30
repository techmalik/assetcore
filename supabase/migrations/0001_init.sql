-- ============================================================================
-- AssetCore — 0001_init
-- Core multi-tenant schema: organizations, sites, profiles, roles, memberships,
-- asset_categories, assets, work_orders, work_order_activity, audit_log.
-- Every tenant table carries org_id and is protected by Row-Level Security.
-- org_id is injected into the JWT by custom_access_token_hook (bottom of file).
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Shared helpers
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

-- Current tenant from the JWT claim added by the auth hook.
create or replace function public.current_org_id()
returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'org_id', '')::uuid;
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
-- profiles (1:1 with auth.users)
-- ----------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  full_name  text not null default '',
  email      text,
  phone      text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''), new.email)
  on conflict (id) do nothing;
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

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
  user_id    uuid not null references auth.users(id) on delete cascade,
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
  assignee_id uuid references auth.users(id) on delete set null,
  created_by  uuid references auth.users(id) on delete set null,
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
  user_id       uuid references auth.users(id) on delete set null,
  kind          text not null default 'comment'
                  check (kind in ('comment','status_change','assignment','attachment')),
  body          text,
  attachments   jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);
create index wo_activity_wo_idx on public.work_order_activity (work_order_id);

-- ----------------------------------------------------------------------------
-- audit_log (append-only)
-- ----------------------------------------------------------------------------
create table public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  entity_type text not null,
  entity_id   uuid,
  before      jsonb,
  after       jsonb,
  ip          text,
  created_at  timestamptz not null default now()
);
create index audit_log_org_idx on public.audit_log (org_id, created_at desc);

-- ============================================================================
-- Row-Level Security
-- ============================================================================
alter table public.roles               enable row level security;
alter table public.organizations       enable row level security;
alter table public.profiles            enable row level security;
alter table public.sites               enable row level security;
alter table public.memberships         enable row level security;
alter table public.asset_categories    enable row level security;
alter table public.assets              enable row level security;
alter table public.work_orders         enable row level security;
alter table public.work_order_activity enable row level security;
alter table public.audit_log           enable row level security;

-- roles: any authenticated user may read the reference list.
create policy roles_read on public.roles for select to authenticated using (true);

-- organizations: members can read/update their own org.
create policy org_select on public.organizations for select to authenticated
  using (id = current_org_id());
create policy org_update on public.organizations for update to authenticated
  using (id = current_org_id());

-- profiles: self, plus anyone sharing an org with you (for assignee names).
create policy profiles_self on public.profiles for select to authenticated
  using (id = auth.uid());
create policy profiles_same_org on public.profiles for select to authenticated
  using (exists (
    select 1 from public.memberships m1
    join public.memberships m2 on m1.org_id = m2.org_id
    where m1.user_id = auth.uid() and m2.user_id = profiles.id
  ));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid());

-- memberships: members can read memberships within their org.
create policy memberships_select on public.memberships for select to authenticated
  using (org_id = current_org_id());
-- The Auth server (running the access-token hook) must read memberships to
-- resolve the caller's org_id/role — grant it explicit read access.
create policy memberships_auth_admin_read on public.memberships
  as permissive for select to supabase_auth_admin using (true);

-- Standard tenant tables: full access scoped to the caller's org.
-- (Reusable shape — copy for every future tenant table.)
create policy sites_all on public.sites for all to authenticated
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy categories_all on public.asset_categories for all to authenticated
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy assets_all on public.assets for all to authenticated
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy work_orders_all on public.work_orders for all to authenticated
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy wo_activity_all on public.work_order_activity for all to authenticated
  using (org_id = current_org_id()) with check (org_id = current_org_id());

-- audit_log: append-only — SELECT + INSERT scoped to org, no UPDATE/DELETE policy.
create policy audit_select on public.audit_log for select to authenticated
  using (org_id = current_org_id());
create policy audit_insert on public.audit_log for insert to authenticated
  with check (org_id = current_org_id());

-- ============================================================================
-- Grants (RLS is the gate; these expose the tables to the API roles)
-- ============================================================================
grant usage on schema public to anon, authenticated;
grant select on public.roles to authenticated;
grant select, update on public.organizations to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.memberships to authenticated;
grant select, insert, update, delete on public.sites to authenticated;
grant select, insert, update, delete on public.asset_categories to authenticated;
grant select, insert, update, delete on public.assets to authenticated;
grant select, insert, update, delete on public.work_orders to authenticated;
grant select, insert, update, delete on public.work_order_activity to authenticated;
grant select, insert on public.audit_log to authenticated;

-- ============================================================================
-- create_organization — security-definer RPC so a freshly-registered user
-- (who has no org_id claim yet) can create their org + owner membership.
-- After calling this, the client refreshes its session to mint a JWT with org_id.
-- ============================================================================
create or replace function public.create_organization(
  p_name        text,
  p_short_name  text default null,
  p_industry    text default null,
  p_region      text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if exists (select 1 from public.memberships where user_id = v_uid) then
    raise exception 'user already belongs to an organization';
  end if;

  insert into public.organizations (name, short_name, industry, region)
  values (p_name, p_short_name, p_industry, p_region)
  returning id into v_org;

  insert into public.memberships (org_id, user_id, role_key, status)
  values (v_org, v_uid, 'owner', 'active');

  return v_org;
end; $$;

grant execute on function public.create_organization to authenticated;

-- ============================================================================
-- custom_access_token_hook — injects org_id + role_key into the access-token
-- claims so RLS (current_org_id()) and the UI can read the active tenant.
-- Enable in: Dashboard → Authentication → Hooks → Custom Access Token
--   (or supabase/config.toml [auth.hook.custom_access_token]).
-- ============================================================================
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable as $$
declare
  v_claims jsonb := event -> 'claims';
  v_org  uuid;
  v_role text;
begin
  select org_id, role_key into v_org, v_role
  from public.memberships
  where user_id = (event ->> 'user_id')::uuid and status = 'active'
  order by created_at asc
  limit 1;

  if v_org is not null then
    v_claims := jsonb_set(v_claims, '{org_id}',   to_jsonb(v_org::text));
    v_claims := jsonb_set(v_claims, '{role_key}', to_jsonb(v_role));
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end; $$;

-- The Auth admin role executes the hook; no one else should.
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
grant usage on schema public to supabase_auth_admin;
grant select on public.memberships to supabase_auth_admin;
