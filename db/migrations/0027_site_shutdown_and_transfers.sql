-- ============================================================================
-- 0027_site_shutdown_and_transfers
--
--   1. sites.status          — a site can be shut down, with when/why/who
--   2. assets 'inactive'     — what an asset at a shut-down site is, plus the
--                              status it had so a reopen can give it back
--   3. asset_transfers       — the record of an asset moving between sites
--   4. is_work_suspended()   — one definition of "no work happens here"
--   5. the automation        — health crossings, PM generation, overdue and
--                              due-soon notifications and escalations all
--                              skip suspended assets and sites
--
-- A shut-down site is not an archived one. Archiving (deleted_at) hides a site
-- that should never have existed or no longer matters; shutting one down keeps
-- it, and everything at it, on the register — the assets are still owned,
-- still carry book value, and may be moved elsewhere or brought back when the
-- site reopens. What stops is the work: nothing new is raised there, by a
-- person or by a cron job.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Site status
-- ----------------------------------------------------------------------------
alter table public.sites add column if not exists status text not null default 'active';
alter table public.sites add column if not exists shutdown_at timestamptz;
alter table public.sites add column if not exists shutdown_reason text;
alter table public.sites add column if not exists shutdown_by uuid references public.users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sites_status_check') then
    alter table public.sites add constraint sites_status_check
      check (status in ('active','shutdown'));
  end if;
end $$;

create index if not exists sites_shutdown_idx on public.sites (org_id) where status = 'shutdown';

-- ----------------------------------------------------------------------------
-- 2. Assets: 'inactive'
--
-- Not 'offline'. Offline is an operator's decision about one asset and stays
-- theirs to reverse; inactive follows from the site and is reversed by the
-- site reopening (or the asset being transferred out). Folding the two into
-- one value would mean a reopen could not tell which assets to bring back.
--
-- status_before_shutdown is what the reopen restores, per asset — a unit that
-- was on standby before the shutdown goes back to standby, not to operational.
-- ----------------------------------------------------------------------------
alter table public.assets drop constraint assets_status_check;

alter table public.assets add constraint assets_status_check
  check (status in ('operational', 'maintenance', 'standby', 'offline', 'attention', 'critical', 'inactive'));

alter table public.assets add column if not exists status_before_shutdown text;

-- ----------------------------------------------------------------------------
-- 3. asset_transfers
--
-- Append-only, like approval_events: a transfer that happened is history, and
-- correcting a wrong one is another transfer, not an edit. from_site_id is
-- nullable because an asset registered without a site can still be placed.
-- transferred_at is a date the user states (the move may be recorded after the
-- lorry arrived); created_at is when it was written down.
-- ----------------------------------------------------------------------------
create table if not exists public.asset_transfers (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  asset_id       uuid not null references public.assets(id) on delete cascade,
  from_site_id   uuid references public.sites(id) on delete set null,
  to_site_id     uuid not null references public.sites(id),
  reason         text,
  transferred_at date not null default current_date,
  transferred_by uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index if not exists asset_transfers_asset_idx on public.asset_transfers (asset_id, transferred_at desc);
create index if not exists asset_transfers_org_idx   on public.asset_transfers (org_id, transferred_at desc);
create index if not exists asset_transfers_from_idx  on public.asset_transfers (from_site_id);
create index if not exists asset_transfers_to_idx    on public.asset_transfers (to_site_id);

alter table public.asset_transfers enable row level security;

create policy asset_transfers_sel on public.asset_transfers for select
  using (org_id = current_org_id());
create policy asset_transfers_ins on public.asset_transfers for insert
  with check (org_id = current_org_id());

grant select, insert on public.asset_transfers to assetcore_app;

-- ----------------------------------------------------------------------------
-- 4. is_work_suspended()
--
-- True when the site is shut down, or the asset is inactive or sits on a
-- shut-down site. Every producer below asks this one question rather than each
-- growing its own join, so "shut down" cannot mean slightly different things
-- to the health pass and to the escalation run.
--
-- security definer because the callers are themselves definer functions run
-- from the owner pool, and the answer must not depend on a caller's site scope.
-- ----------------------------------------------------------------------------
create or replace function public.is_work_suspended(p_site_id uuid, p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
           select 1 from public.sites s
           where s.id = p_site_id and s.status = 'shutdown'
         )
      or exists (
           select 1 from public.assets a
           left join public.sites s on s.id = a.site_id
           where a.id = p_asset_id
             and (a.status = 'inactive' or s.status = 'shutdown')
         )
$$;

grant execute on function public.is_work_suspended(uuid, uuid) to assetcore_app;

-- Escalations only know an entity's type and id, so this resolves the
-- site/asset for the entity types that carry work. Approvals and licences are
-- deliberately not suspended: a licence at a shut-down site still expires, and
-- a pending decision is still somebody's to make.
create or replace function public.is_entity_work_suspended(p_entity_type text, p_entity_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_site  uuid;
  v_asset uuid;
begin
  if p_entity_type = 'work_order' then
    select site_id, asset_id into v_site, v_asset from public.work_orders where id = p_entity_id;
  elsif p_entity_type = 'pm_task' then
    select site_id, asset_id into v_site, v_asset from public.pm_tasks where id = p_entity_id;
  elsif p_entity_type = 'inspection' then
    select site_id, asset_id into v_site, v_asset from public.inspections where id = p_entity_id;
  elsif p_entity_type = 'defect' then
    select site_id, asset_id into v_site, v_asset from public.defects where id = p_entity_id;
  else
    return false;
  end if;
  return public.is_work_suspended(v_site, v_asset);
end;
$$;

grant execute on function public.is_entity_work_suspended(text, uuid) to assetcore_app;

-- ----------------------------------------------------------------------------
-- 5. The automation
--
-- Each function below is the latest definition copied unchanged, with only the
-- suspension check added — and, for apply_asset_health, the role keys as 0026
-- rewrote them (ops_manager -> admin, manager; maint_engineer -> supervisor).
-- Sources: apply_asset_health, recompute_asset_health,
-- mark_overdue_pm_tasks, notify_pm_due — 0016; generate_pm_tasks — 0025;
-- run_escalations — 0023.
-- ----------------------------------------------------------------------------

-- apply_asset_health (from 0016)
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

  -- 0027: a shut-down site raises nothing. Returning before the score is
  -- stored, not just before the inserts, matters: storing it would record the
  -- crossing as already passed, and a site reopened with the asset still in
  -- poor condition would then never raise the inspection it needs.
  if public.is_work_suspended(v_asset.site_id, v_asset.id) then
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
        array['owner', 'admin', 'manager', 'hse_officer'], p_actor,
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
        array['owner', 'admin', 'manager', 'supervisor'], p_actor,
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

-- recompute_asset_health (from 0016)
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
      -- 0027: nothing decays at a shut-down site.
      and not public.is_work_suspended(a.site_id, a.id)
  loop
    perform public.recompute_asset_health_for(v_id, null);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.recompute_asset_health(uuid) to assetcore_app;

-- mark_overdue_pm_tasks (from 0016)
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
    and due_date < current_date
    -- 0027: work at a shut-down site is paused, not late.
    and not public.is_work_suspended(site_id, asset_id);

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

-- notify_pm_due (from 0016)
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
      -- 0027: no "due soon" for work nobody can do.
      and not public.is_work_suspended(t.site_id, t.asset_id)
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

-- generate_pm_tasks (from 0025)
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
  v_checklist jsonb;
  v_task_id   uuid;
begin
  for v_schedule in
    select s.*
    from public.pm_schedules s
    where s.active = true
      and s.deleted_at is null
      and s.next_due <= current_date + interval '7 days'
      and (p_org_id is null or s.org_id = p_org_id)
      -- 0027: a schedule at a shut-down site generates nothing. next_due is
      -- left where it is, so on reopen the schedule picks up with the task
      -- that was due rather than skipping it.
      and not public.is_work_suspended(s.site_id, s.asset_id)
      and not exists (
        select 1 from public.pm_tasks t
        where t.schedule_id = s.id
          and t.status in ('pending','in_progress')
      )
  loop
    -- ["Check oil level", ...] becomes
    -- [{"item":"Check oil level","result":"pending","notes":null}, ...]
    select coalesce(
             jsonb_agg(jsonb_build_object('item', item, 'result', 'pending', 'notes', null)),
             '[]'::jsonb
           )
      into v_checklist
      from jsonb_array_elements_text(v_schedule.checklist_template) as item;

    insert into public.pm_tasks (
      org_id, schedule_id, asset_id, site_id,
      title, description, status, due_date, assignee_id, checklist_results
    ) values (
      v_schedule.org_id, v_schedule.id, v_schedule.asset_id, v_schedule.site_id,
      v_schedule.title, v_schedule.description, 'pending',
      v_schedule.next_due, v_schedule.assignee_id, v_checklist
    )
    returning id into v_task_id;

    -- The task, not the schedule, is the actionable unit, so the notification
    -- points at the task and dedupes on it.
    if v_schedule.assignee_id is not null then
      perform public.notify_users(
        v_schedule.org_id, array[v_schedule.assignee_id], null,
        'pm_assigned', 'PM task assigned to you: ' || v_schedule.title,
        'Due ' || to_char(v_schedule.next_due, 'DD Mon YYYY') || '.',
        'pm_task', v_task_id, 'pm_assigned:' || v_task_id
      );
    end if;

    v_next_due := case
      when v_schedule.interval_days is not null
        then v_schedule.next_due + (v_schedule.interval_days || ' days')::interval
      when v_schedule.frequency = 'daily'       then v_schedule.next_due + interval '1 day'
      when v_schedule.frequency = 'weekly'      then v_schedule.next_due + interval '1 week'
      when v_schedule.frequency = 'monthly'     then v_schedule.next_due + interval '1 month'
      when v_schedule.frequency = 'quarterly'   then v_schedule.next_due + interval '3 months'
      when v_schedule.frequency = 'semi_annual' then v_schedule.next_due + interval '6 months'
      when v_schedule.frequency = 'annual'      then v_schedule.next_due + interval '1 year'
      else v_schedule.next_due + interval '1 month'
    end;

    update public.pm_schedules set next_due = v_next_due where id = v_schedule.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- run_escalations (from 0023)
create or replace function public.run_escalations(p_org_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule       record;
  v_candidate  record;
  v_inner      text;
  v_notified   int;
  v_count      int := 0;
begin
  for v_rule in
    select r.* from public.escalation_rules r
    where r.active and r.deleted_at is null
      and (p_org_id is null or r.org_id = p_org_id)
  loop
    -- $1 = org_id, $2 = threshold_days.
    v_inner := case
      when v_rule.entity_type = 'work_order' and v_rule.trigger = 'overdue' then $q$
        select w.id, w.org_id, w.ref || ' — ' || w.title as label, w.priority as f_priority, null::text as f_severity
        from public.work_orders w
        where w.org_id = $1 and w.deleted_at is null and w.status <> 'closed'
          and w.sla_due is not null and w.sla_due < now() - ($2 || ' days')::interval $q$
      when v_rule.entity_type = 'work_order' and v_rule.trigger = 'unassigned' then $q$
        select w.id, w.org_id, w.ref || ' — ' || w.title as label, w.priority as f_priority, null::text as f_severity
        from public.work_orders w
        where w.org_id = $1 and w.deleted_at is null and w.status <> 'closed'
          and w.assignee_id is null and w.created_at < now() - ($2 || ' days')::interval $q$
      when v_rule.entity_type = 'work_order' and v_rule.trigger = 'stale' then $q$
        select w.id, w.org_id, w.ref || ' — ' || w.title as label, w.priority as f_priority, null::text as f_severity
        from public.work_orders w
        where w.org_id = $1 and w.deleted_at is null and w.status <> 'closed'
          and w.updated_at < now() - ($2 || ' days')::interval $q$
      when v_rule.entity_type = 'pm_task' and v_rule.trigger = 'overdue' then $q$
        select t.id, t.org_id, t.title as label, null::text as f_priority, null::text as f_severity
        from public.pm_tasks t
        where t.org_id = $1 and t.status in ('pending','in_progress','overdue')
          and t.due_date < current_date - ($2 || ' days')::interval $q$
      when v_rule.entity_type = 'pm_task' and v_rule.trigger = 'unassigned' then $q$
        select t.id, t.org_id, t.title as label, null::text as f_priority, null::text as f_severity
        from public.pm_tasks t
        where t.org_id = $1 and t.status in ('pending','in_progress','overdue')
          and t.assignee_id is null and t.due_date < current_date - ($2 || ' days')::interval $q$
      when v_rule.entity_type = 'defect' and v_rule.trigger = 'overdue' then $q$
        select d.id, d.org_id, d.ref || ' — ' || d.title as label, null::text as f_priority, d.severity as f_severity
        from public.defects d
        where d.org_id = $1 and d.deleted_at is null
          and d.status in ('open','acknowledged','in_progress','deferred')
          and d.due_date is not null and d.due_date < current_date - ($2 || ' days')::interval $q$
      when v_rule.entity_type = 'defect' and v_rule.trigger = 'unacknowledged' then $q$
        select d.id, d.org_id, d.ref || ' — ' || d.title as label, null::text as f_priority, d.severity as f_severity
        from public.defects d
        where d.org_id = $1 and d.deleted_at is null and d.status = 'open'
          and d.identified_date < current_date - ($2 || ' days')::interval $q$
      when v_rule.entity_type = 'defect' and v_rule.trigger = 'stale' then $q$
        select d.id, d.org_id, d.ref || ' — ' || d.title as label, null::text as f_priority, d.severity as f_severity
        from public.defects d
        where d.org_id = $1 and d.deleted_at is null
          and d.status in ('open','acknowledged','in_progress')
          and d.updated_at < now() - ($2 || ' days')::interval $q$
      when v_rule.entity_type = 'inspection' and v_rule.trigger = 'overdue' then $q$
        select i.id, i.org_id, i.title as label, null::text as f_priority, null::text as f_severity
        from public.inspections i
        where i.org_id = $1 and i.status in ('scheduled','due','in_progress','overdue')
          and i.scheduled_date < current_date - ($2 || ' days')::interval $q$
      when v_rule.entity_type = 'inspection' and v_rule.trigger = 'unassigned' then $q$
        select i.id, i.org_id, i.title as label, null::text as f_priority, null::text as f_severity
        from public.inspections i
        where i.org_id = $1 and i.status in ('scheduled','due','in_progress','overdue')
          and i.inspector_id is null
          and i.scheduled_date < current_date - ($2 || ' days')::interval $q$
      when v_rule.entity_type = 'approval' and v_rule.trigger = 'unacknowledged' then $q$
        select a.id, a.org_id, coalesce(a.title, a.kind) as label, null::text as f_priority, null::text as f_severity
        from public.approvals a
        where a.org_id = $1 and a.status = 'pending'
          and a.created_at < now() - ($2 || ' days')::interval $q$
      when v_rule.entity_type = 'approval' and v_rule.trigger = 'overdue' then $q$
        select a.id, a.org_id, coalesce(a.title, a.kind) as label, null::text as f_priority, null::text as f_severity
        from public.approvals a
        where a.org_id = $1 and a.status = 'pending'
          and a.due_date is not null and a.due_date < current_date - ($2 || ' days')::interval $q$
      when v_rule.entity_type = 'compliance_licence' and v_rule.trigger = 'overdue' then $q$
        select cl.id, cl.org_id, cl.name as label, null::text as f_priority, null::text as f_severity
        from public.compliance_licences cl
        where cl.org_id = $1 and cl.deleted_at is null
          and cl.expiry_date < current_date - ($2 || ' days')::interval $q$
      else null
    end;

    -- A rule whose entity/trigger pair has no query is a combination the UI
    -- should not have offered. Skip it rather than failing the whole run.
    if v_inner is null then continue; end if;

    for v_candidate in
      -- 0027: $5 is the entity type, so work at a shut-down site does not
      -- escalate. Approvals and licences are never suspended (see
      -- is_entity_work_suspended).
      execute 'select * from (' || v_inner || ') c
               where ($3 is null or c.f_priority = $3)
                 and ($4 is null or c.f_severity = $4)
                 and not public.is_entity_work_suspended($5, c.id)'
      using v_rule.org_id, v_rule.threshold_days, v_rule.priority, v_rule.severity, v_rule.entity_type
    loop
      if exists (
        select 1 from public.escalation_events e
        where e.rule_id = v_rule.id and e.entity_id = v_candidate.id
      ) then continue; end if;

      -- Through the preference-aware helper, with a dedupe key, like every
      -- other producer since 0016.
      v_notified := public.notify_role_holders(
        v_rule.org_id, null,
        array[v_rule.notify_role_key],
        null,
        'escalation',
        'Escalation: ' || v_rule.name,
        v_candidate.label || ' has been ' || v_rule.trigger || ' for more than '
          || v_rule.threshold_days || ' day'
          || case when v_rule.threshold_days = 1 then '' else 's' end || '.',
        v_rule.entity_type, v_candidate.id,
        'escalation:' || v_rule.id::text || ':' || v_candidate.id::text
      );

      insert into public.escalation_events (org_id, rule_id, entity_type, entity_id, entity_label, notified_count)
      values (v_rule.org_id, v_rule.id, v_rule.entity_type, v_candidate.id, v_candidate.label,
              coalesce(v_notified, 0));

      v_count := v_count + 1;
    end loop;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.run_escalations(uuid) to assetcore_app;
