-- ============================================================================
-- 0016_derived_health_and_notify_fixes
-- Owner review, two related themes.
--
-- A. Health becomes fully derived.
--    recompute_asset_health() (0007:137) has always owned the number — it
--    decays linearly from 100 at last_maintenance_at to 0 at
--    next_maintenance_at — but the asset form still offered an "Initial
--    health %" input and the API still honoured a health_score in the body.
--    Anything a user typed was silently overwritten at 01:00, which is a lie
--    in the UI. The manual path is removed in the same commit series
--    (apps/api/src/routes/assets.ts, apps/app/src/pages/Assets.jsx).
--
--    Removing it exposes two gaps that this migration closes: a new asset
--    would have had null health until the next cron run, and editing the
--    maintenance dates would have left a stale score behind. The per-row half
--    of the decay loop is extracted into recompute_asset_health_for() so the
--    API can call it synchronously on create and on any maintenance-date
--    change — the same shape 0007 used when it extracted apply_asset_health().
--
-- B. Notification hardening.
--    1. inspection_due, maintenance_due (0013:68,91) and pm_overdue (0001:454)
--       INSERT into public.notifications directly. They therefore ignore
--       notification_preferences entirely — a user who switched those off in
--       the preferences UI received them anyway — and set no dedupe_key, so a
--       repeated crossing could duplicate. All three now route through
--       notify_users()/notify_role_holders() (0014:32,91), which handle both.
--    2. maintenance_due fired BEFORE the auto-WO dedupe check, so it could
--       announce "a work order has been drafted" on a crossing where no work
--       order was drafted (one was already open). Both threshold
--       notifications now sit inside their dedupe guard, so each fires exactly
--       once per artefact actually created, and the body is true.
--    3. A work-order comment notified only the assignee — never the person who
--       raised the WO, who is usually the one waiting on the answer. The
--       creator is now notified too.
--    4. pm_due had a preferences toggle promising a 7-day warning and zero
--       producers anywhere in the codebase. notify_pm_due() implements it.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A. apply_asset_health v3 — same crossing semantics as 0013, but both
-- notifications now go through the preference-aware helpers and sit inside
-- their respective dedupe guards.
-- ----------------------------------------------------------------------------
create or replace function public.apply_asset_health(p_asset_id uuid, p_new_health int, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset     record;
  v_threshold int;
  v_maint     int;
  v_new       int := greatest(0, least(100, p_new_health));
  v_ref       text;
  v_insp_id   uuid;
  v_wo_id     uuid;
begin
  select a.id, a.org_id, a.name, a.site_id, a.health_score, a.assigned_operator_id,
         coalesce((o.settings->'health'->>'inspectionThreshold')::int, 50) as insp_threshold,
         coalesce((o.settings->'health'->>'maintenanceThreshold')::int, 30) as maint_threshold
  into v_asset
  from public.assets a
  join public.organizations o on o.id = a.org_id
  where a.id = p_asset_id and a.deleted_at is null
  for update of a;

  if not found then
    return;
  end if;

  v_threshold := v_asset.insp_threshold;
  v_maint     := v_asset.maint_threshold;

  -- Inspection: crossing down through the configurable threshold. The
  -- notification now lives inside the dedupe guard alongside the inspection
  -- insert — one alert per inspection actually raised, rather than one per
  -- crossing regardless of whether anything was created.
  if coalesce(v_asset.health_score, 100) > v_threshold and v_new <= v_threshold then
    if not exists (
      select 1 from public.inspections i
      where i.asset_id = v_asset.id and i.status in ('scheduled', 'due', 'in_progress')
        and i.title like 'Auto:%'
    ) then
      insert into public.inspections (org_id, site_id, asset_id, kind, title, status, scheduled_date)
      values (v_asset.org_id, v_asset.site_id, v_asset.id, 'condition',
              'Auto: health at ' || v_new || '% — condition inspection required',
              'due', current_date + 7)
      returning id into v_insp_id;

      perform public.notify_role_holders(
        v_asset.org_id, v_asset.site_id,
        array['owner', 'ops_manager', 'hse_officer'], p_actor,
        'inspection_due', 'Inspection due: ' || v_asset.name,
        'Health has fallen to ' || v_new || '%. A condition inspection has been raised.',
        'asset', v_asset.id, 'inspection_due:' || v_insp_id
      );

      if v_asset.assigned_operator_id is not null then
        perform public.notify_users(
          v_asset.org_id, array[v_asset.assigned_operator_id], p_actor,
          'inspection_due', 'Inspection due: ' || v_asset.name,
          'Health has fallen to ' || v_new || '%. A condition inspection has been raised.',
          'asset', v_asset.id, 'inspection_due:' || v_insp_id
        );
      end if;

      insert into public.asset_activity (org_id, asset_id, user_id, kind, body)
      values (v_asset.org_id, v_asset.id, p_actor, 'alert',
              'Inspection alert: health fell to ' || v_new || '% (threshold ' || v_threshold || '%).');
    end if;
  end if;

  -- Maintenance alert + auto work order. Both the notification and the
  -- activity entry are inside the dedupe guard now, so the body's claim that
  -- a work order has been drafted is always true.
  if coalesce(v_asset.health_score, 100) > v_maint and v_new <= v_maint then
    if not exists (
      select 1 from public.work_orders w
      where w.asset_id = v_asset.id and w.deleted_at is null and w.status <> 'closed'
        and w.type = 'corrective' and w.title like 'Auto:%'
    ) then
      v_ref := public.next_wo_ref(v_asset.org_id);

      insert into public.work_orders (org_id, site_id, asset_id, ref, title, description, type, status, priority)
      values (v_asset.org_id, v_asset.site_id, v_asset.id, v_ref,
              'Auto: health critical — ' || v_asset.name,
              'Auto-drafted because asset health fell to ' || v_new || '%. Review and approve.',
              'corrective', 'draft', 'high')
      returning id into v_wo_id;

      perform public.notify_role_holders(
        v_asset.org_id, v_asset.site_id,
        array['owner', 'ops_manager', 'maint_engineer'], p_actor,
        'maintenance_due', 'Maintenance required: ' || v_asset.name,
        'Health critical at ' || v_new || '%. Work order ' || v_ref || ' has been drafted for approval.',
        'asset', v_asset.id, 'maintenance_due:' || v_wo_id
      );

      insert into public.asset_activity (org_id, asset_id, user_id, kind, body)
      values (v_asset.org_id, v_asset.id, p_actor, 'alert',
              'Maintenance alert: health fell to ' || v_new || '%. Work order ' || v_ref || ' auto-drafted.');
    end if;
  end if;

  update public.assets set health_score = v_new where id = v_asset.id;
end;
$$;

grant execute on function public.apply_asset_health(uuid, int, uuid) to assetcore_app;

-- ----------------------------------------------------------------------------
-- recompute_asset_health_for — the per-row half of the decay loop, callable
-- from the API so a create or a maintenance-date edit produces a correct score
-- immediately instead of at 01:00 tomorrow. No-ops (leaving health untouched)
-- when the asset has no usable maintenance window, matching the loop's own
-- WHERE clause in 0007:151-154.
-- ----------------------------------------------------------------------------
create or replace function public.recompute_asset_health_for(p_asset_id uuid, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset record;
  v_new   int;
begin
  select a.id, a.last_maintenance_at, a.next_maintenance_at
  into v_asset
  from public.assets a
  where a.id = p_asset_id and a.deleted_at is null;

  if not found
     or v_asset.last_maintenance_at is null
     or v_asset.next_maintenance_at is null
     or v_asset.next_maintenance_at <= v_asset.last_maintenance_at then
    return;
  end if;

  v_new := greatest(0, least(100, round(
    100.0 * (v_asset.next_maintenance_at - current_date)
          / (v_asset.next_maintenance_at - v_asset.last_maintenance_at)
  )::int));

  perform public.apply_asset_health(v_asset.id, v_new, p_actor);
end;
$$;

grant execute on function public.recompute_asset_health_for(uuid, uuid) to assetcore_app;

-- The nightly loop now delegates rather than duplicating the formula.
create or replace function public.recompute_asset_health(p_org_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_count int := 0;
begin
  for v_id in
    select a.id
    from public.assets a
    where a.deleted_at is null
      and a.last_maintenance_at is not null
      and a.next_maintenance_at is not null
      and a.next_maintenance_at > a.last_maintenance_at
      and (p_org_id is null or a.org_id = p_org_id)
  loop
    perform public.recompute_asset_health_for(v_id, null);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.recompute_asset_health(uuid) to assetcore_app;

-- ----------------------------------------------------------------------------
-- B1/B2. mark_overdue_pm_tasks — same behaviour, but the notification now
-- respects notification_preferences and dedupes on the task id instead of a
-- 1-day "did we already say this" subquery.
-- ----------------------------------------------------------------------------
create or replace function public.mark_overdue_pm_tasks()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_task  record;
begin
  update public.pm_tasks
  set status = 'overdue', updated_at = now()
  where status = 'pending'
    and due_date < current_date;

  get diagnostics v_count = row_count;

  for v_task in
    select t.id, t.org_id, t.title, t.due_date, t.assignee_id
    from public.pm_tasks t
    where t.status = 'overdue'
      and t.assignee_id is not null
      and t.updated_at >= now() - interval '1 minute'
  loop
    perform public.notify_users(
      v_task.org_id, array[v_task.assignee_id], null,
      'pm_overdue', 'PM task overdue: ' || v_task.title,
      'Due ' || to_char(v_task.due_date, 'DD Mon YYYY') || ' — please complete or reschedule.',
      'pm_task', v_task.id, 'pm_overdue:' || v_task.id
    );
  end loop;

  return v_count;
end;
$$;

grant execute on function public.mark_overdue_pm_tasks() to assetcore_app;

-- ----------------------------------------------------------------------------
-- B4. pm_due — the 7-day warning the preferences UI has always promised and
-- nothing ever sent. Deduped per task, so the daily cron announces each task
-- once no matter how many days it sits in the window.
-- ----------------------------------------------------------------------------
create or replace function public.notify_pm_due(p_org_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task  record;
  v_count int := 0;
begin
  for v_task in
    select t.id, t.org_id, t.title, t.due_date, t.assignee_id
    from public.pm_tasks t
    where t.status = 'pending'
      and t.assignee_id is not null
      and t.due_date >= current_date
      and t.due_date <= current_date + 7
      and (p_org_id is null or t.org_id = p_org_id)
  loop
    v_count := v_count + public.notify_users(
      v_task.org_id, array[v_task.assignee_id], null,
      'pm_due', 'PM task due soon: ' || v_task.title,
      'Due ' || to_char(v_task.due_date, 'DD Mon YYYY') || '.',
      'pm_task', v_task.id, 'pm_due:' || v_task.id
    );
  end loop;

  return v_count;
end;
$$;

grant execute on function public.notify_pm_due(uuid) to assetcore_app;

-- ----------------------------------------------------------------------------
-- B3. notify_wo_activity — the assignee branch is unchanged; a comment now
-- also reaches the person who raised the work order. Guarded so the commenter
-- never notifies themselves and the creator is skipped when they are already
-- the assignee (notify_users would have deduped the user anyway, but the
-- second call is pointless).
-- ----------------------------------------------------------------------------
create or replace function public.notify_wo_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo    record;
  v_title text;
  v_body  text;
  v_kind  text;
  v_pref  boolean;
begin
  select * into v_wo from public.work_orders where id = new.work_order_id;
  if not found then return new; end if;

  -- Comments also reach the raiser of the work order, who is usually the one
  -- waiting on the answer. Runs before the assignee guard below so an
  -- unassigned WO still notifies its creator.
  if new.kind = 'comment'
     and v_wo.created_by is not null
     and v_wo.created_by is distinct from new.user_id
     and v_wo.created_by is distinct from v_wo.assignee_id then
    perform public.notify_users(
      v_wo.org_id, array[v_wo.created_by], new.user_id,
      'wo_comment', 'New comment on ' || coalesce(v_wo.ref, 'unknown'),
      left(new.body, 120), 'work_order', v_wo.id, null
    );
  end if;

  if v_wo.assignee_id is null then return new; end if;
  if v_wo.assignee_id = new.user_id then return new; end if;

  if new.kind = 'status_change' then
    v_kind  := 'wo_transition';
    v_title := 'Work order updated: ' || coalesce(v_wo.ref, 'unknown');
    v_body  := new.body;
  elsif new.kind = 'comment' then
    v_kind  := 'wo_comment';
    v_title := 'New comment on ' || coalesce(v_wo.ref, 'unknown');
    v_body  := left(new.body, 120);
  elsif new.kind = 'assignment' then
    v_kind  := 'wo_assigned';
    v_title := 'Work order assigned to you: ' || coalesce(v_wo.ref, 'unknown');
    v_body  := new.body;
  else
    return new;
  end if;

  select coalesce(np.in_app, true) into v_pref
  from public.notification_preferences np
  where np.org_id = v_wo.org_id and np.user_id = v_wo.assignee_id and np.kind = v_kind;
  if v_pref is null then v_pref := true; end if;
  if not v_pref then return new; end if;

  insert into public.notifications (org_id, user_id, kind, title, body, entity_type, entity_id)
  values (v_wo.org_id, v_wo.assignee_id, v_kind, v_title, v_body, 'work_order', v_wo.id);

  return new;
end;
$$;

comment on column public.assets.health_score is
  'DERIVED — written only by apply_asset_health(); not client-writable. Decays from 100 at last_maintenance_at to 0 at next_maintenance_at.';
