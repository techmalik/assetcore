-- ============================================================================
-- 0014_activity_assignment_notifications
--
-- Owner review: PM tasks/schedules and inspections have had assignee/inspector
-- columns since 0001 and the API has accepted them since day one, but no UI
-- ever set them, and nothing anywhere notified anyone of an assignment, a
-- completion, or a report upload (only threshold/expiry-driven notifications
-- existed: wo_transition, wo_comment, pm_overdue, licence_expiry,
-- inspection_due, maintenance_due). The `wo_assigned` kind was a dead stub —
-- referenced in the notifications.kind comment and the frontend's
-- preferences UI, but never once inserted.
--
-- This migration adds the reusable notification plumbing (two generic,
-- security-definer helpers — the RLS pool can insert notifications for other
-- org members (notifications_ins only checks org_id), but it CANNOT read
-- another user's notification_preferences (notif_prefs_sel is
-- user_id = current_user_id()), so respecting prefs requires definer
-- functions) and wires up the two places that fire without any route-level
-- involvement: the existing WO-activity trigger (revives wo_assigned) and
-- generate_pm_tasks() (adds pm_assigned). The rest of the new kinds
-- (inspection_assigned, work_completed, report_uploaded) are fired directly
-- from the API routes in the same commit series, via these helpers.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- notify_users: generic per-user notifier. SECURITY DEFINER because the
-- RLS-scoped pool cannot read a recipient's notification_preferences row.
-- Guards against a spoofed org_id from a caller running under the app role
-- (current_org_id() is set) by requiring it match the session's own org;
-- cron/definer callers (which set no app.org_id GUC) pass freely.
-- ----------------------------------------------------------------------------
create or replace function public.notify_users(
  p_org_id uuid,
  p_user_ids uuid[],
  p_actor uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_entity_type text,
  p_entity_id uuid,
  p_dedupe_prefix text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid;
  v_pref     boolean;
  v_inserted int;
  v_count    int := 0;
begin
  if current_org_id() is not null and p_org_id is distinct from current_org_id() then
    return 0;
  end if;

  for v_uid in
    select distinct u from unnest(coalesce(p_user_ids, '{}')) u
    where u is not null and (p_actor is null or u <> p_actor)
  loop
    select coalesce(np.in_app, true) into v_pref
    from public.notification_preferences np
    where np.org_id = p_org_id and np.user_id = v_uid and np.kind = p_kind;
    if v_pref is null then v_pref := true; end if; -- no row = default on
    if not v_pref then continue; end if;

    insert into public.notifications (org_id, user_id, kind, title, body, entity_type, entity_id, dedupe_key)
    values (
      p_org_id, v_uid, p_kind, p_title, p_body, p_entity_type, p_entity_id,
      case when p_dedupe_prefix is null then null else p_dedupe_prefix || ':' || v_uid end
    )
    on conflict (org_id, dedupe_key) where dedupe_key is not null do nothing;
    get diagnostics v_inserted = row_count;
    v_count := v_count + v_inserted;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.notify_users(uuid, uuid[], uuid, text, text, text, text, uuid, text) to assetcore_app;

-- ----------------------------------------------------------------------------
-- notify_role_holders: resolves an org's active members holding any of
-- p_roles, applying the same site/location-scope carve-out check_licence_expiry()
-- (0010) uses — unscoped staff (both scopes null) or a null p_site_id (org-wide
-- entity) see it regardless; otherwise the site (or its location) must be in
-- the member's scope. Delegates to notify_users for the actual fan-out.
-- ----------------------------------------------------------------------------
create or replace function public.notify_role_holders(
  p_org_id uuid,
  p_site_id uuid,
  p_roles text[],
  p_actor uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_entity_type text,
  p_entity_id uuid,
  p_dedupe_prefix text default null
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  select array_agg(m.user_id) into v_ids
  from public.memberships m
  where m.org_id = p_org_id and m.status = 'active' and m.role_key = any(p_roles)
    and (
      (m.site_scope is null and m.location_scope is null)
      or p_site_id is null
      or p_site_id = any(coalesce(m.site_scope, '{}'))
      or exists (
           select 1 from public.sites s
           where s.id = p_site_id and s.location_id = any(coalesce(m.location_scope, '{}'))
         )
    );

  return public.notify_users(p_org_id, v_ids, p_actor, p_kind, p_title, p_body,
                              p_entity_type, p_entity_id, p_dedupe_prefix);
end;
$$;

grant execute on function public.notify_role_holders(uuid, uuid, text[], uuid, text, text, text, text, uuid, text) to assetcore_app;

-- ----------------------------------------------------------------------------
-- Revive wo_assigned: notify_wo_activity() (0001) already no-ops when
-- assignee is null or the actor IS the assignee, and silently ignores any
-- activity kind other than status_change/comment — so adding an
-- 'assignment' branch gets those guards for free. The API inserts a
-- work_order_activity row of kind 'assignment' whenever a WO's assignee_id
-- is set or changed (workOrders.ts, same commit series); this trigger reacts
-- to that row. Everything else about the function/trigger is unchanged.
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
-- Trigger object itself (trg_notify_wo_activity) is unchanged — CREATE OR
-- REPLACE FUNCTION is enough; no DROP/CREATE TRIGGER needed.

-- ----------------------------------------------------------------------------
-- generate_pm_tasks: identical to 0001's version except the task insert
-- captures its id and, when the parent schedule has a default assignee,
-- fires pm_assigned. The task (not the schedule) is the actionable unit —
-- it carries a concrete due date — so this is where assignment becomes
-- something worth telling someone about. Deduped per task id so a cron
-- re-run (or a manually re-triggered /pm/generate) never double-fires.
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
  v_task_id   uuid;
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
    )
    returning id into v_task_id;

    if v_schedule.assignee_id is not null then
      perform public.notify_users(
        v_schedule.org_id, array[v_schedule.assignee_id], null,
        'pm_assigned', 'PM task assigned to you: ' || v_schedule.title,
        'Due ' || to_char(v_schedule.next_due, 'DD Mon YYYY') || '.',
        'pm_task', v_task_id, 'pm_assigned:' || v_task_id
      );
    end if;

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

comment on column public.notifications.kind is
  'wo_transition|wo_comment|wo_assigned|pm_assigned|pm_due|pm_overdue|inspection_assigned|inspection_due|maintenance_due|work_completed|report_uploaded|licence_expiry|system';
