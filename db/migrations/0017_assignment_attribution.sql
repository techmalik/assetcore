-- ============================================================================
-- 0017_assignment_attribution
-- Owner review: "if someone assigns a WO or something to someone, does it show
-- who assigned it?" It did not — and for two of the three assignable entities
-- the assigner was never recorded at all:
--
--   work_orders  — the assigner survived only as work_order_activity.user_id on
--                  the 'assignment' row, surfaced in the UI as an unlabelled
--                  byline under "Assigned to Jane Doe." A reader had to infer
--                  that the name underneath was the assigner rather than the
--                  assignee's own entry.
--   pm_tasks     — nothing. No pm_task_activity table exists and the assignee
--                  change path never called writeAuditLog (routes/pmTasks.ts
--                  only audits completion), so an assignment left no durable
--                  trace of who made it.
--   inspections  — only a generic `inspection.update` audit row with no
--                  `before`, so it could not even be identified as an
--                  assignment, let alone attributed.
--
-- Real columns rather than deriving from an activity feed, because two of the
-- three have no activity feed to derive from. They also fix a live bug in
-- notifyWorkOrderClosed() (apps/api/src/notify.ts), which reverse-engineers
-- "the assigner" as the newest 'assignment' activity row — but UNassigning
-- writes one of those too, so an assign-by-A / unassign-by-B sequence reported
-- B as the assigner.
--
-- Also adds notifications.actor_id. notify_users() has always taken p_actor and
-- used it for self-exclusion only (0014:60), discarding it afterwards, so no
-- notification could say who did the thing it was announcing.
-- ============================================================================

alter table public.work_orders
  add column if not exists assigned_by uuid references public.users(id) on delete set null,
  add column if not exists assigned_at timestamptz;

alter table public.pm_tasks
  add column if not exists assigned_by uuid references public.users(id) on delete set null,
  add column if not exists assigned_at timestamptz;

alter table public.inspections
  add column if not exists assigned_by uuid references public.users(id) on delete set null,
  add column if not exists assigned_at timestamptz;

alter table public.notifications
  add column if not exists actor_id uuid references public.users(id) on delete set null;

-- ----------------------------------------------------------------------------
-- Backfill work_orders from the activity feed — the only place this history
-- exists. Deliberately skips 'Assignee removed.' rows: they carry the
-- UNassigner, and treating them as assignments is exactly the bug described
-- above. Only fills work orders that currently have an assignee, so a WO that
-- was assigned and later cleared doesn't acquire a phantom assigner.
--
-- pm_tasks and inspections have no history to recover; they stay null and
-- populate from their next assignment onward. Null reads correctly as
-- "assigned before we started recording this", and is also what a
-- system-generated PM task legitimately has.
-- ----------------------------------------------------------------------------
update public.work_orders w
set assigned_by = a.user_id,
    assigned_at = a.created_at
from (
  select distinct on (wa.work_order_id)
         wa.work_order_id, wa.user_id, wa.created_at
  from public.work_order_activity wa
  where wa.kind = 'assignment'
    and wa.user_id is not null
    and wa.body is distinct from 'Assignee removed.'
  order by wa.work_order_id, wa.created_at desc
) a
where a.work_order_id = w.id
  and w.assignee_id is not null
  and w.assigned_by is null;

-- ----------------------------------------------------------------------------
-- notify_users: same signature and behaviour, but p_actor is now stored on the
-- row instead of being used for the self-exclusion check and then thrown away.
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

    insert into public.notifications (org_id, user_id, actor_id, kind, title, body, entity_type, entity_id, dedupe_key)
    values (
      p_org_id, v_uid, p_actor, p_kind, p_title, p_body, p_entity_type, p_entity_id,
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
-- notify_wo_activity: the assignment branch used `new.body` as the notification
-- body, and that body is "Assigned to <assignee>." — so the assignee received a
-- notification telling them their own name. Redundant, and it spent the one
-- free text field on the thing the recipient already knows. It now names the
-- assigner, and the row records actor_id.
--
-- Everything else (the comment→creator branch from 0016, the status_change and
-- assignment kinds, the preference check) is unchanged.
-- ----------------------------------------------------------------------------
create or replace function public.notify_wo_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_wo     record;
  v_title  text;
  v_body   text;
  v_kind   text;
  v_pref   boolean;
  v_actor  text;
begin
  select * into v_wo from public.work_orders where id = new.work_order_id;
  if not found then return new; end if;

  select full_name into v_actor from public.users where id = new.user_id;

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
    v_body  := 'Assigned by ' || coalesce(v_actor, 'a team member') || '.';
  else
    return new;
  end if;

  select coalesce(np.in_app, true) into v_pref
  from public.notification_preferences np
  where np.org_id = v_wo.org_id and np.user_id = v_wo.assignee_id and np.kind = v_kind;
  if v_pref is null then v_pref := true; end if;
  if not v_pref then return new; end if;

  insert into public.notifications (org_id, user_id, actor_id, kind, title, body, entity_type, entity_id)
  values (v_wo.org_id, v_wo.assignee_id, new.user_id, v_kind, v_title, v_body, 'work_order', v_wo.id);

  return new;
end;
$$;

comment on column public.work_orders.assigned_by is
  'Who assigned it (null = never assigned, or assigned before 0017). Distinct from created_by.';
comment on column public.notifications.actor_id is
  'Who caused this notification. Null for system/cron-generated events.';
