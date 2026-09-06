-- ============================================================================
-- 0025_health_breakdown_and_pm_notify_fix
--
-- Two corrections to 0021-0024, both caught by this lineage's own integration
-- suite rather than by anything I wrote.
--
-- 1. health_score_components / health_score_computed_at were never added.
--    The scoring engine writes the breakdown it shows the user, so every
--    asset write 500'd on a missing column. The breakdown is the whole point
--    of the new score — a number nobody can take apart is the unexplained
--    figure it replaced — so the columns belong here, not the write.
--
-- 2. 0022's generate_pm_tasks() rewrite dropped the pm_assigned notification
--    0014 had added. The rewrite was for the checklist template and
--    interval_days; losing the notification with it meant a technician
--    stopped being told a task had been assigned to them. Both features now
--    live in one function.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The stored breakdown
--
-- Deliberately not health_score_source: manual entry stays removed (0016).
-- These two columns describe how the derived number was arrived at, which is
-- the opposite of letting someone type over it.
-- ----------------------------------------------------------------------------
alter table public.assets add column if not exists health_score_components jsonb;
alter table public.assets add column if not exists health_score_computed_at timestamptz;

comment on column public.assets.health_score_components is
  'DERIVED — the per-signal working behind health_score, written only by '
  'apps/api/src/healthService.ts. Not client-writable.';

-- ----------------------------------------------------------------------------
-- 2. generate_pm_tasks — checklist template AND the assignment notification
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
