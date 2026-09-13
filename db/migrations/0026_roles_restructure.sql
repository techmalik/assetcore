-- ============================================================================
-- 0026 — role set restructure.
--
-- The seven roles shipped in 0001/0004 were named after one client's field
-- organisation (ops_manager, maint_engineer, field_tech). The org chart the
-- product is sold into has governance and executive tiers those names can't
-- express, so the set becomes:
--
--   owner (System Admin), admin, managing_director, executive_director,
--   manager, supervisor, officer, hse_officer, auditor, viewer
--
-- with existing data moved ops_manager→manager, maint_engineer→supervisor,
-- field_tech→officer. The capability map lives in packages/rbac/index.js;
-- this migration only keeps the database's copy of the keys in step with it.
--
-- `owner` keeps its key: RLS policies (org_update etc.) and scripts/provision
-- test role_key = 'owner' literally.
-- ============================================================================

-- 1. New rows first — every role_key column is a foreign key to roles(key), so
--    the target keys have to exist before data moves onto them.
insert into public.roles (key, label, description, rank) values
  ('admin',              'Admin',              'Runs the organisation day to day: users, locations, approval matrix and escalations.', 90),
  ('managing_director',  'Managing Director',  'Executive oversight: reads everything, audit log, decides approvals.', 85),
  ('executive_director', 'Executive Director', 'Executive oversight: reads everything, audit log, decides approvals.', 80),
  ('manager',            'Manager',            'Assigns and tracks work orders, maintains locations, handles escalations.', 70),
  ('supervisor',         'Supervisor',         'Raises and assigns work orders, works schedules and inspections, completes jobs.', 55),
  ('officer',            'Officer',            'On-site: updates work orders, logs inspections and defects.', 30)
on conflict (key) do update
  set label = excluded.label, description = excluded.description, rank = excluded.rank;

update public.roles set label = 'System Admin', rank = 100,
  description = 'Full access incl. org settings, users, integrations and depreciation posting.'
  where key = 'owner';
update public.roles set label = 'HSE / Compliance Officer', rank = 60 where key = 'hse_officer';
update public.roles set rank = 40 where key = 'auditor';
update public.roles set label = 'Viewer / Guest', rank = 10,
  description = 'Read-only access to business data.'
  where key = 'viewer';

-- 2. Move data off the old keys, in every column that stores a role key.
--    approval_events.role_key has no FK (it's a historical record of who the
--    step was waiting on) but is renamed too, so history reads in the same
--    vocabulary the app now labels.
do $$
declare
  m record;
begin
  for m in select * from (values
    ('ops_manager', 'manager'),
    ('maint_engineer', 'supervisor'),
    ('field_tech', 'officer')
  ) as t(old_key, new_key)
  loop
    update public.memberships          set role_key         = m.new_key where role_key         = m.old_key;
    update public.approval_rule_levels set role_key         = m.new_key where role_key         = m.old_key;
    update public.approvals            set current_role_key = m.new_key where current_role_key = m.old_key;
    update public.approval_events      set role_key         = m.new_key where role_key         = m.old_key;
    update public.escalation_rules     set notify_role_key  = m.new_key where notify_role_key  = m.old_key;
  end loop;
end $$;

-- 3. Rewrite functions that hardcode the old keys (apply_asset_health,
--    check_licence_expiry, check_low_stock at the time of writing — found
--    dynamically so a function this file didn't know about isn't missed).
--
--    The replacements match the QUOTED literal, so 'hse_officer' is never
--    touched by the field_tech/officer rename. 'ops_manager' becomes
--    'admin', 'manager': every such literal sits in a notification role list
--    next to 'owner', and an admin — who now runs the org day to day — has to
--    hear about the same health drops, expiring licences and low stock the
--    managers do. Unquoted mentions (comments) are renamed plainly.
do $$
declare
  f record;
  def text;
begin
  for f in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosrc ~ 'ops_manager|maint_engineer|field_tech'
  loop
    def := pg_get_functiondef(f.oid);
    def := replace(def, '''ops_manager''', '''admin'', ''manager''');
    def := replace(def, '''maint_engineer''', '''supervisor''');
    def := replace(def, '''field_tech''', '''officer''');
    def := regexp_replace(def, '\mops_manager\M', 'manager', 'g');
    def := regexp_replace(def, '\mmaint_engineer\M', 'supervisor', 'g');
    def := regexp_replace(def, '\mfield_tech\M', 'officer', 'g');
    execute def;
  end loop;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~ 'ops_manager|maint_engineer|field_tech'
  ) then
    raise exception '0026: a function still references a retired role key';
  end if;

  -- Nothing in RLS names the retired keys today; fail loudly rather than
  -- leave a policy silently matching no one if that ever stops being true.
  if exists (
    select 1 from pg_policies
    where coalesce(qual, '') ~ 'ops_manager|maint_engineer|field_tech'
       or coalesce(with_check, '') ~ 'ops_manager|maint_engineer|field_tech'
  ) then
    raise exception '0026: an RLS policy still references a retired role key';
  end if;
end $$;

-- 4. Retire the old rows. Any row still pointing at them would fail the FK
--    here, which is the check we want.
delete from public.roles where key in ('ops_manager', 'maint_engineer', 'field_tech');
