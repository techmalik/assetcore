-- ============================================================================
-- AssetCore — 0005_backoffice
-- Platform backoffice (admin.assetcore.com): cross-tenant operations console for
-- AssetCore's OWN staff. These tables are deliberately OUTSIDE the per-org RLS
-- model — they are reached through the `admin-api` Edge Function using the
-- service-role key, which bypasses RLS. The RLS policies below are a safety net
-- (self-read / admin-read only); no tenant ever reads across orgs.
--
--   platform_admins       — who is allowed into the backoffice (+ platform role)
--   platform_audit_log    — append-only record of every admin action (all orgs)
--   billing_invoices      — invoice/PO billing (USD cents; no payment integration)
--   org_notes             — internal support notes per tenant org
--   impersonation_grants  — time-boxed, audited read-only support access
-- ============================================================================

-- ----------------------------------------------------------------------------
-- platform_admins — an auth.users row flagged as AssetCore staff.
-- Platform admins normally have NO membership, so the access-token hook injects
-- no org_id (correct — they are not a tenant).
-- ----------------------------------------------------------------------------
-- user_id references profiles(id) (1:1 with auth.users) so PostgREST can embed
-- the admin's email — same FK-to-profiles pattern as 0002_fix_profile_fks.sql.
create table public.platform_admins (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  role       text not null default 'support'
               check (role in ('superadmin','admin','support','billing')),
  full_name  text not null default '',
  status     text not null default 'active'
               check (status in ('active','disabled')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Security-definer so it can read platform_admins from inside other RLS policies
-- without the caller needing direct access to the table.
create or replace function public.is_platform_admin(uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.platform_admins
    where user_id = uid and status = 'active'
  );
$$;

-- ----------------------------------------------------------------------------
-- platform_audit_log — append-only; one row per privileged admin action.
-- Distinct from the per-org public.audit_log. Written by the Edge layer
-- (service role); never updated or deleted.
-- ----------------------------------------------------------------------------
create table public.platform_audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_id    uuid references public.profiles(id) on delete set null,  -- embeddable actor
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

-- ----------------------------------------------------------------------------
-- billing_invoices — invoice/PO billing. Money in integer cents, USD.
-- ----------------------------------------------------------------------------
create table public.billing_invoices (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  number       text not null unique,                 -- e.g. INV-2026-0007
  period_start date,
  period_end   date,
  amount_cents bigint not null default 0,
  currency     text not null default 'USD',
  status       text not null default 'draft'
                 check (status in ('draft','sent','paid','overdue','void')),
  po_number    text,
  issued_at    timestamptz,
  due_at       timestamptz,
  paid_at      timestamptz,
  notes        text,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index billing_invoices_org_idx    on public.billing_invoices (org_id, created_at desc);
create index billing_invoices_status_idx on public.billing_invoices (status);
create trigger billing_invoices_set_updated_at before update on public.billing_invoices
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- org_notes — internal support notes (admin-only).
-- ----------------------------------------------------------------------------
create table public.org_notes (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,  -- embeddable author
  body       text not null,
  created_at timestamptz not null default now()
);
create index org_notes_org_idx on public.org_notes (org_id, created_at desc);

-- ----------------------------------------------------------------------------
-- impersonation_grants — time-boxed, reason-logged read-only support access.
-- ----------------------------------------------------------------------------
create table public.impersonation_grants (
  id         uuid primary key default gen_random_uuid(),
  admin_id   uuid not null references auth.users(id) on delete cascade,
  org_id     uuid not null references public.organizations(id) on delete cascade,
  reason     text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index impersonation_admin_idx on public.impersonation_grants (admin_id, created_at desc);
create index impersonation_org_idx   on public.impersonation_grants (org_id, created_at desc);

-- ----------------------------------------------------------------------------
-- Repoint memberships.user_id → profiles(id) (1:1 with auth.users) so the
-- backoffice can embed profile name/email in the cross-org user directory.
-- Same semantics-preserving pattern as 0002_fix_profile_fks.sql.
-- ----------------------------------------------------------------------------
alter table public.memberships
  drop constraint if exists memberships_user_id_fkey,
  add constraint memberships_user_id_fkey
    foreign key (user_id) references public.profiles(id) on delete cascade;

-- ============================================================================
-- Row-Level Security
-- The backoffice reaches these via the service role (bypasses RLS). Policies
-- here are a defense-in-depth floor for the anon/authenticated API roles.
-- ============================================================================
alter table public.platform_admins      enable row level security;
alter table public.platform_audit_log   enable row level security;
alter table public.billing_invoices      enable row level security;
alter table public.org_notes             enable row level security;
alter table public.impersonation_grants  enable row level security;

-- platform_admins: a user may read ONLY their own row (so the SPA can ask
-- "am I an admin, and which platform role?"). No write policies → writes only
-- via service role.
create policy platform_admins_self on public.platform_admins for select to authenticated
  using (user_id = auth.uid());

-- platform_audit_log: readable only by active platform admins.
create policy platform_audit_read on public.platform_audit_log for select to authenticated
  using (public.is_platform_admin(auth.uid()));

-- billing_invoices: tenant members may read their own org's invoices (for a
-- future tenant-side billing view). Admin CRUD happens via service role.
create policy billing_invoices_org_read on public.billing_invoices for select to authenticated
  using (org_id = current_org_id());

-- org_notes & impersonation_grants: no authenticated policies (admin-only via
-- service role); RLS on with no policy = deny for the anon/authenticated roles.
create policy impersonation_self_read on public.impersonation_grants for select to authenticated
  using (admin_id = auth.uid());

-- ============================================================================
-- Grants (RLS is the gate; these expose the tables to the API roles)
-- service_role bypasses RLS and already has full access — no grant needed.
-- ============================================================================
grant select on public.platform_admins     to authenticated;
grant select on public.platform_audit_log  to authenticated;
grant select on public.billing_invoices    to authenticated;
grant select on public.impersonation_grants to authenticated;

-- ============================================================================
-- Suspension gate — fold org soft-delete into the access-token hook so that
-- suspending an org (organizations.deleted_at set) immediately removes its
-- members' org_id claim on their next token refresh, cutting tenant access.
-- (CREATE OR REPLACE of the hook defined in 0001_init.sql — only the org join
-- with a deleted_at guard is added.)
-- ============================================================================
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb language plpgsql stable as $$
declare
  v_claims jsonb := event -> 'claims';
  v_org  uuid;
  v_role text;
begin
  select m.org_id, m.role_key into v_org, v_role
  from public.memberships m
  join public.organizations o on o.id = m.org_id
  where m.user_id = (event ->> 'user_id')::uuid
    and m.status = 'active'
    and o.deleted_at is null            -- suspended org → no org_id claim
  order by m.created_at asc
  limit 1;

  if v_org is not null then
    v_claims := jsonb_set(v_claims, '{org_id}',   to_jsonb(v_org::text));
    v_claims := jsonb_set(v_claims, '{role_key}', to_jsonb(v_role));
  end if;

  return jsonb_set(event, '{claims}', v_claims);
end; $$;

grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
-- The hook now also reads organizations.
grant select on public.organizations to supabase_auth_admin;
