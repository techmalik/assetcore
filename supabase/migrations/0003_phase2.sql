-- Phase 2: pm_schedules, pm_tasks, notifications, notification_preferences
-- Plus: WO activity notification trigger, PM overdue detection function

-- ── PM Schedules ──────────────────────────────────────────────────────────────

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
  assignee_id      uuid references public.profiles(id) on delete set null,
  active           boolean not null default true,
  created_at       timestamptz default now(),
  deleted_at       timestamptz
);

create index pm_schedules_org_idx  on public.pm_schedules (org_id);
create index pm_schedules_due_idx  on public.pm_schedules (org_id, next_due) where deleted_at is null;

alter table public.pm_schedules enable row level security;
create policy pm_schedules_sel on public.pm_schedules for select using (org_id = (auth.jwt()->>'org_id')::uuid);
create policy pm_schedules_ins on public.pm_schedules for insert with check (org_id = (auth.jwt()->>'org_id')::uuid);
create policy pm_schedules_upd on public.pm_schedules for update using (org_id = (auth.jwt()->>'org_id')::uuid);

-- ── PM Tasks ─────────────────────────────────────────────────────────────────

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
  assignee_id         uuid references public.profiles(id) on delete set null,
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

alter table public.pm_tasks enable row level security;
create policy pm_tasks_sel on public.pm_tasks for select using (org_id = (auth.jwt()->>'org_id')::uuid);
create policy pm_tasks_ins on public.pm_tasks for insert with check (org_id = (auth.jwt()->>'org_id')::uuid);
create policy pm_tasks_upd on public.pm_tasks for update using (org_id = (auth.jwt()->>'org_id')::uuid);

-- ── Notifications ─────────────────────────────────────────────────────────────

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  user_id      uuid not null references public.profiles(id) on delete cascade,
  kind         text not null,  -- wo_assigned|wo_transition|wo_comment|pm_due|pm_overdue|system
  title        text not null,
  body         text,
  entity_type  text,           -- 'work_order'|'pm_task'|'pm_schedule'
  entity_id    uuid,
  read         boolean not null default false,
  created_at   timestamptz default now()
);

create index notifications_user_idx   on public.notifications (user_id, read, created_at desc);
create index notifications_org_idx    on public.notifications (org_id, created_at desc);

alter table public.notifications enable row level security;
-- Users only see their own notifications
create policy notifications_sel on public.notifications for select
  using (user_id = auth.uid());
create policy notifications_upd on public.notifications for update
  using (user_id = auth.uid());
-- Service-level inserts (from triggers) bypass RLS via security definer functions
create policy notifications_ins on public.notifications for insert
  with check (org_id = (auth.jwt()->>'org_id')::uuid);

-- Enable Realtime so the client can subscribe
alter publication supabase_realtime add table public.notifications;

-- ── Notification Preferences ─────────────────────────────────────────────────

create table public.notification_preferences (
  id       uuid primary key default gen_random_uuid(),
  org_id   uuid not null references public.organizations(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  kind     text not null,
  in_app   boolean not null default true,
  email    boolean not null default false,
  unique (org_id, user_id, kind)
);

alter table public.notification_preferences enable row level security;
create policy notif_prefs_sel on public.notification_preferences for select using (user_id = auth.uid());
create policy notif_prefs_ins on public.notification_preferences for insert with check (user_id = auth.uid());
create policy notif_prefs_upd on public.notification_preferences for update using (user_id = auth.uid());

-- ── Trigger: notify on WO activity ───────────────────────────────────────────

-- Inserts a notification row whenever a WO status changes or a comment is added,
-- targeting the WO assignee (if different from the actor).
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
  -- Don't notify the actor about their own action
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

-- ── Function: generate PM tasks for due schedules ────────────────────────────

-- Called manually (from the UI) or by pg_cron. Creates pending pm_task rows for
-- schedules whose next_due is within the next 7 days and have no pending/in_progress task.
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

    -- Advance next_due based on frequency
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

-- ── Function: mark overdue PM tasks ──────────────────────────────────────────

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

  -- Generate notifications for newly-overdue tasks
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

-- ── Grants ────────────────────────────────────────────────────────────────────

grant select, insert, update, delete on public.pm_schedules            to authenticated;
grant select, insert, update, delete on public.pm_tasks                to authenticated;
grant select, insert, update         on public.notifications            to authenticated;
grant select, insert, update, delete on public.notification_preferences to authenticated;

grant execute on function public.generate_pm_tasks(uuid)    to authenticated;
grant execute on function public.mark_overdue_pm_tasks()    to authenticated;

-- To enable pg_cron (run once as superuser after enabling the extension):
-- select cron.schedule('generate-pm-tasks',  '0 6 * * *', 'select public.generate_pm_tasks()');
-- select cron.schedule('mark-overdue-tasks',  '5 0 * * *', 'select public.mark_overdue_pm_tasks()');
