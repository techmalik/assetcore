-- ============================================================================
-- 0007_health_lifecycle_fixes
-- TASK-2.1 / TASK-2.2: the 50%/30% crossing logic (notifications, alerts,
-- auto-drafted work order) only ever ran inside the daily cron
-- (recompute_asset_health), so:
--   a) a manual health_score edit via the asset API bypassed it entirely —
--      dropping an asset straight to 20% via PATCH produced no inspection,
--      no notification, no work order until the next 01:00 run;
--   b) the crossing logic was duplicated nowhere else, so there was no way
--      to reuse it from the API layer without copy-pasting SQL;
--   c) the 50% crossing only ever inserted a notification — no actual
--      inspection record, so nothing showed up on the Inspections page;
--   d) the decay loop's `next_maintenance_at > last_maintenance_at` guard
--      (needed to avoid dividing by zero) meant any asset whose reset left
--      next_maintenance_at <= last_maintenance_at was silently skipped by
--      every future run — health pinned wherever it last was, forever.
--
-- Fix: extract the crossing logic into apply_asset_health(asset_id,
-- new_health, actor), callable both from the cron loop and from the API on
-- any health_score write (see apps/api/src/routes/assets.ts). It also now
-- creates a real 'due' inspection record on the 50% crossing, not just a
-- notification, and attributes the resulting activity entries to the actor
-- when the crossing was caused by a manual edit (null from the cron).
-- ============================================================================

-- One-time backfill: existing rows the decay loop can never reach.
update public.assets
set next_maintenance_at = current_date + 90
where next_maintenance_at is not null
  and last_maintenance_at is not null
  and next_maintenance_at <= last_maintenance_at;

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
  v_year      int := extract(year from current_date)::int;
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
      select 'WO-' || v_year || '-' || lpad((count(*) + 1)::text, 4, '0')
      into v_ref
      from public.work_orders
      where org_id = v_asset.org_id and ref like 'WO-' || v_year || '-%';

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

-- Decay loop now just computes the interval-proportional value and delegates
-- the crossing logic (and the row update) to apply_asset_health.
create or replace function public.recompute_asset_health(p_org_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset record;
  v_new   int;
  v_count int := 0;
begin
  for v_asset in
    select a.id, a.health_score, a.last_maintenance_at, a.next_maintenance_at
    from public.assets a
    where a.deleted_at is null
      and a.last_maintenance_at is not null
      and a.next_maintenance_at is not null
      and a.next_maintenance_at > a.last_maintenance_at
      and (p_org_id is null or a.org_id = p_org_id)
  loop
    v_new := greatest(0, least(100, round(
      100.0 * (v_asset.next_maintenance_at - current_date)
            / (v_asset.next_maintenance_at - v_asset.last_maintenance_at)
    )::int));

    perform public.apply_asset_health(v_asset.id, v_new, null);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.recompute_asset_health(uuid) to assetcore_app;
