-- ============================================================================
-- 0011_wo_ref_counter
-- TASK-3.3: WO-{year}-{seq} references were generated two different ways -
-- workOrders.ts's generateWoRef() counts existing rows matching 'WO-{year}-%'
-- under RLS, and apply_asset_health()'s auto-draft path (0007) does the same
-- count under org_id directly. Two independent counts of "how many refs
-- already start with this prefix" racing against each other can compute the
-- same next number and collide - caught by the unique constraint on
-- work_orders.ref, but that surfaces as a raw 500 to whichever request loses
-- the race, not a real error the caller can act on.
--
-- Replaces both with one real counter: an upsert against a small per-org,
-- per-year table under that row's implicit lock, so concurrent callers
-- serialize on the UPDATE instead of both reading the same "count so far".
-- ============================================================================

create table if not exists public.wo_ref_counters (
  org_id  uuid not null references public.organizations(id) on delete cascade,
  year    int not null,
  next_seq int not null default 1,
  primary key (org_id, year)
);

-- Owner-pool only (called from security definer functions and, via a plain
-- query, from the API's RLS-enforced pool inside an org-scoped transaction) -
-- no direct end-user access is meaningful here, so no RLS policy is needed
-- beyond the table being unreachable without going through next_wo_ref().
grant select, insert, update on public.wo_ref_counters to assetcore_app;

create or replace function public.next_wo_ref(p_org_id uuid)
returns text
language plpgsql
as $$
declare
  v_year int := extract(year from current_date)::int;
  v_seq  int;
begin
  insert into public.wo_ref_counters (org_id, year, next_seq)
  values (p_org_id, v_year, 2)
  on conflict (org_id, year) do update set next_seq = wo_ref_counters.next_seq + 1
  returning next_seq - 1 into v_seq;
  return 'WO-' || v_year || '-' || lpad(v_seq::text, 4, '0');
end;
$$;

grant execute on function public.next_wo_ref(uuid) to assetcore_app;

-- Backfill: seed each org's counter past its highest existing ref for the
-- current year, so the very first call after this migration doesn't collide
-- with refs created before the counter existed.
insert into public.wo_ref_counters (org_id, year, next_seq)
select w.org_id, extract(year from current_date)::int,
       coalesce(max(substring(w.ref from '\d+$')::int), 0) + 1
from public.work_orders w
where w.ref like 'WO-' || extract(year from current_date)::int || '-%'
group by w.org_id
on conflict (org_id, year) do update set next_seq = greatest(wo_ref_counters.next_seq, excluded.next_seq);

-- Re-point apply_asset_health's auto-WO ref generation at next_wo_ref()
-- instead of its own count-existing-rows query (0007_health_lifecycle_fixes.sql)
-- — the API side is updated in the same task (workOrders.ts's generateWoRef
-- replaced with a call to this same function).
create or replace function public.apply_asset_health(p_asset_id uuid, p_new_health int, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset     record;
  v_threshold int;
  v_new       int := greatest(0, least(100, p_new_health));
  v_ref       text;
begin
  select a.id, a.org_id, a.name, a.site_id, a.health_score, a.assigned_operator_id,
         coalesce((o.settings->'health'->>'inspectionThreshold')::int, 50) as insp_threshold
  into v_asset
  from public.assets a
  join public.organizations o on o.id = a.org_id
  where a.id = p_asset_id and a.deleted_at is null
  for update of a;

  if not found then
    return;
  end if;

  v_threshold := v_asset.insp_threshold;

  -- Inspection: crossing down through the configurable threshold. Creates a
  -- real inspection record (not just a notification) so it shows up as an
  -- actionable item on the Inspections page, deduped like the auto-WO below.
  if coalesce(v_asset.health_score, 100) > v_threshold and v_new <= v_threshold then
    if not exists (
      select 1 from public.inspections i
      where i.asset_id = v_asset.id and i.status in ('scheduled', 'due', 'in_progress')
        and i.title like 'Auto:%'
    ) then
      insert into public.inspections (org_id, site_id, asset_id, kind, title, status, scheduled_date)
      values (v_asset.org_id, v_asset.site_id, v_asset.id, 'condition',
              'Auto: health at ' || v_new || '% — condition inspection required',
              'due', current_date + 7);
    end if;

    insert into public.notifications (org_id, user_id, kind, title, body, entity_type, entity_id)
    select v_asset.org_id, m.user_id, 'inspection_due',
           'Inspection due: ' || v_asset.name,
           'Health has fallen to ' || v_new || '%. Schedule an inspection.',
           'asset', v_asset.id
    from public.memberships m
    where m.org_id = v_asset.org_id and m.status = 'active'
      and m.role_key in ('owner', 'ops_manager', 'hse_officer')
    union
    select v_asset.org_id, v_asset.assigned_operator_id, 'inspection_due',
           'Inspection due: ' || v_asset.name,
           'Health has fallen to ' || v_new || '%. Schedule an inspection.',
           'asset', v_asset.id
    where v_asset.assigned_operator_id is not null;

    insert into public.asset_activity (org_id, asset_id, user_id, kind, body)
    values (v_asset.org_id, v_asset.id, p_actor, 'alert',
            'Inspection alert: health fell to ' || v_new || '% (threshold ' || v_threshold || '%).');
  end if;

  -- Maintenance alert + auto work order: crossing down through 30 (fixed,
  -- not admin-configurable, per the requirements).
  if coalesce(v_asset.health_score, 100) > 30 and v_new <= 30 then
    insert into public.notifications (org_id, user_id, kind, title, body, entity_type, entity_id)
    select v_asset.org_id, m.user_id, 'maintenance_due',
           'Maintenance required: ' || v_asset.name,
           'Health critical at ' || v_new || '%. A work order has been drafted.',
           'asset', v_asset.id
    from public.memberships m
    where m.org_id = v_asset.org_id and m.status = 'active'
      and m.role_key in ('owner', 'ops_manager', 'maint_engineer');

    if not exists (
      select 1 from public.work_orders w
      where w.asset_id = v_asset.id and w.deleted_at is null and w.status <> 'closed'
        and w.type = 'corrective' and w.title like 'Auto:%'
    ) then
      v_ref := public.next_wo_ref(v_asset.org_id);

      insert into public.work_orders (org_id, site_id, asset_id, ref, title, description, type, status, priority)
      values (v_asset.org_id, v_asset.site_id, v_asset.id, v_ref,
              'Auto: health critical — ' || v_asset.name,
              'Auto-drafted because asset health fell to ' || v_new || '%. Review and assign.',
              'corrective', 'new', 'high');

      insert into public.asset_activity (org_id, asset_id, user_id, kind, body)
      values (v_asset.org_id, v_asset.id, p_actor, 'alert',
              'Maintenance alert: health fell to ' || v_new || '%. Work order ' || v_ref || ' auto-drafted.');
    end if;
  end if;

  update public.assets set health_score = v_new where id = v_asset.id;
end;
$$;

grant execute on function public.apply_asset_health(uuid, int, uuid) to assetcore_app;
