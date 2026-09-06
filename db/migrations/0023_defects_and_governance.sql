-- ============================================================================
-- 0023_defects_and_governance
--
-- The record that connects a finding to the work that clears it, and the
-- governance around both.
--
--   1. defects              — inspection -> defect -> work order
--   2. inspection_templates — the checklist definition inspections never had
--   3. approvals            — the scaffold in 0001 gets a matrix and a history
--   4. escalation_rules     — entity + trigger + threshold -> notify a role
--
-- Notifications here route through notify_role_holders()/notify_users()
-- (0014), not raw inserts, so they respect notification_preferences and
-- dedupe — the correction 0016 applied to every other producer.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Defects register
--
-- Before this, an inspection recorded that something was wrong in a `findings`
-- text box and a work order was raised from memory, with nothing joining the
-- two. A defect is that join: raised from an inspection (or standalone),
-- carrying its own severity and due date, pointing at the job raised to clear
-- it. Closing that job resolves the defect.
-- ----------------------------------------------------------------------------
create table if not exists public.defects (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  ref              text not null,                 -- DEF-2026-0001, unique per org
  asset_id         uuid references public.assets(id) on delete set null,
  site_id          uuid references public.sites(id) on delete set null,

  inspection_id    uuid references public.inspections(id) on delete set null,
  work_order_id    uuid references public.work_orders(id) on delete set null,

  title            text not null,
  description      text,
  -- Severity is the defect's own judgement, not the asset's criticality. A
  -- minor defect on a critical asset is still a minor defect.
  severity         text not null default 'moderate'
                     check (severity in ('minor','moderate','major','critical')),
  status           text not null default 'open'
                     check (status in ('open','acknowledged','in_progress','resolved','closed','deferred')),
  category         text,
  reported_by      uuid references public.users(id) on delete set null,
  assigned_to      uuid references public.users(id) on delete set null,
  identified_date  date not null default current_date,
  due_date         date,
  resolved_at      timestamptz,
  resolution_notes text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz,
  unique (org_id, ref)
);
create index if not exists defects_org_status_idx on public.defects (org_id, status) where deleted_at is null;
create index if not exists defects_asset_idx      on public.defects (asset_id) where deleted_at is null;
create index if not exists defects_inspection_idx on public.defects (inspection_id);
create index if not exists defects_wo_idx         on public.defects (work_order_id);
create index if not exists defects_due_idx        on public.defects (org_id, due_date) where deleted_at is null;
create trigger defects_set_updated_at before update on public.defects
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Inspection templates
--
-- inspections.checklist_results has existed since 0001 with no checklist
-- definition behind it, so there was nothing to record results against — the
-- same hole pm_tasks had, closed in 0022. PM's template lives on the schedule;
-- inspections have no schedule, so the template is its own reusable record,
-- picked when the inspection is raised and copied onto it.
-- ----------------------------------------------------------------------------
create table if not exists public.inspection_templates (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  name        text not null,
  kind        text not null default 'condition',
  description text,
  -- ["Check guard rails", "Verify earth bonding", ...]
  items       jsonb not null default '[]'::jsonb,
  active      boolean not null default true,
  created_by  uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (org_id, name)
);
create index if not exists inspection_templates_org_idx on public.inspection_templates (org_id, kind)
  where deleted_at is null;
create trigger inspection_templates_set_updated_at before update on public.inspection_templates
  for each row execute function public.set_updated_at();

alter table public.inspections
  add column if not exists template_id uuid references public.inspection_templates(id) on delete set null;

-- The one number a completed inspection owes: 1 = failed, 5 = as-new. The API
-- refuses to complete an inspection without it, because a condition score
-- built on a rating nobody gave is a guess.
alter table public.inspections add column if not exists condition_rating int;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'inspections_condition_rating_check') then
    alter table public.inspections add constraint inspections_condition_rating_check
      check (condition_rating is null or (condition_rating between 1 and 5));
  end if;
end $$;

create index if not exists insp_asset_completed_idx on public.inspections (asset_id, completed_date desc)
  where status = 'completed';

-- checklist_results settles on the shape generate_pm_tasks() already writes:
--   [{"item": "...", "result": "pass|fail|na|pending", "notes": null}, ...]
comment on column public.inspections.checklist_results is
  'Array of {item, result: pass|fail|na|pending, notes}. Copied from the '
  'inspection_templates row named by template_id when the inspection is raised.';

-- ----------------------------------------------------------------------------
-- 3. Approvals — banding, routing, history
--
-- 0001 shipped an `approvals` table with no routes, no UI and no notion of who
-- should approve what. The matrix is two tables: a rule selects on
-- (entity_type, kind, amount band), and its levels say which role signs at
-- each step, in order.
-- ----------------------------------------------------------------------------
create table if not exists public.approval_rules (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references public.organizations(id) on delete cascade,
  name             text not null,
  entity_type      text not null,
  kind             text not null,
  -- Inclusive floor, exclusive ceiling; null ceiling = no upper bound, so a
  -- matrix is bands sitting end to end with one left open at the top.
  min_amount_cents bigint not null default 0 check (min_amount_cents >= 0),
  max_amount_cents bigint check (max_amount_cents is null or max_amount_cents > min_amount_cents),
  active           boolean not null default true,
  created_by       uuid references public.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);
create index if not exists approval_rules_match_idx
  on public.approval_rules (org_id, entity_type, kind, min_amount_cents)
  where deleted_at is null and active;
create trigger approval_rules_set_updated_at before update on public.approval_rules
  for each row execute function public.set_updated_at();

create table if not exists public.approval_rule_levels (
  id         uuid primary key default gen_random_uuid(),
  org_id     uuid not null references public.organizations(id) on delete cascade,
  rule_id    uuid not null references public.approval_rules(id) on delete cascade,
  level      int  not null check (level >= 1),
  role_key   text not null references public.roles(key),
  label      text,
  created_at timestamptz not null default now(),
  unique (rule_id, level)
);
create index if not exists approval_rule_levels_rule_idx on public.approval_rule_levels (rule_id, level);

alter table public.approvals add column if not exists rule_id uuid references public.approval_rules(id) on delete set null;
alter table public.approvals add column if not exists amount_cents bigint;
alter table public.approvals add column if not exists level      int not null default 1;
alter table public.approvals add column if not exists max_levels int not null default 1;
-- Denormalised from the rule level so "what is waiting on me?" is one index
-- lookup rather than a join through the matrix on every page load.
alter table public.approvals add column if not exists current_role_key text references public.roles(key);
alter table public.approvals add column if not exists title    text;
alter table public.approvals add column if not exists due_date date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'approvals_level_check') then
    alter table public.approvals add constraint approvals_level_check check (level >= 1);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'approvals_max_levels_check') then
    alter table public.approvals add constraint approvals_max_levels_check check (max_levels >= 1);
  end if;
end $$;

-- A request the requester pulled back is neither approved nor rejected, and
-- recording it as either would misstate what happened.
alter table public.approvals drop constraint if exists approvals_status_check;
alter table public.approvals add constraint approvals_status_check
  check (status in ('pending','approved','rejected','recalled'));

create index if not exists approvals_org_status_idx  on public.approvals (org_id, status);
create index if not exists approvals_pending_on_idx  on public.approvals (org_id, current_role_key) where status = 'pending';
create index if not exists approvals_entity_idx      on public.approvals (entity_type, entity_id);
create index if not exists approvals_requester_idx   on public.approvals (requester_id, created_at desc);

-- Append-only: every step, including the ones that changed nothing.
-- `approvals.status` is the current state; this is how it got there.
create table if not exists public.approval_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  approval_id uuid not null references public.approvals(id) on delete cascade,
  level       int not null,
  action      text not null check (action in ('submitted','approved','rejected','recalled')),
  actor_id    uuid references public.users(id) on delete set null,
  role_key    text,
  notes       text,
  created_at  timestamptz not null default now()
);
create index if not exists approval_events_approval_idx on public.approval_events (approval_id, created_at);

-- ----------------------------------------------------------------------------
-- 4. Escalation rules
--
-- "If a critical work order is still open three days past its SLA, tell the
-- operations manager."
-- ----------------------------------------------------------------------------
create table if not exists public.escalation_rules (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  entity_type     text not null
                    check (entity_type in ('work_order','pm_task','defect','inspection','approval','compliance_licence')),
  -- overdue        — past its due date / SLA
  -- unassigned     — nobody owns it yet
  -- unacknowledged — raised but not picked up
  -- stale          — nothing has happened to it
  trigger         text not null check (trigger in ('overdue','unassigned','unacknowledged','stale')),
  threshold_days  int  not null check (threshold_days >= 0),
  -- Optional narrowing: only critical work orders, only major defects.
  priority        text,
  severity        text,
  notify_role_key text not null references public.roles(key),
  active          boolean not null default true,
  created_by      uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists escalation_rules_org_idx on public.escalation_rules (org_id)
  where deleted_at is null and active;
create trigger escalation_rules_set_updated_at before update on public.escalation_rules
  for each row execute function public.set_updated_at();

-- One row per (rule, entity) that has ever fired. An escalation is an event,
-- not a reminder: crossing the threshold raises it once, and the same job
-- crossing it again tomorrow does not raise it again.
create table if not exists public.escalation_events (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  rule_id        uuid not null references public.escalation_rules(id) on delete cascade,
  entity_type    text not null,
  entity_id      uuid not null,
  entity_label   text,
  notified_count int not null default 0,
  created_at     timestamptz not null default now(),
  unique (rule_id, entity_id)
);
create index if not exists escalation_events_org_idx on public.escalation_events (org_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 5. run_escalations() (node-cron: 07:15 daily)
--
-- Each (entity_type, trigger) pair maps to one candidate query projecting a
-- uniform shape: (id, org_id, label, f_priority, f_severity). The rule's
-- optional narrowing is applied once, in a wrapper around whichever query was
-- chosen — so an entity with no priority column projects null and a priority
-- filter correctly matches nothing rather than being silently ignored.
--
-- The queries are fixed strings selected by a case; the only values bound at
-- run time are the rule's own columns. Dynamic dispatch, not SQL assembled
-- from user input.
-- ----------------------------------------------------------------------------
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
      execute 'select * from (' || v_inner || ') c
               where ($3 is null or c.f_priority = $3)
                 and ($4 is null or c.f_severity = $4)'
      using v_rule.org_id, v_rule.threshold_days, v_rule.priority, v_rule.severity
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

-- ----------------------------------------------------------------------------
-- 6. Row-level security + grants
-- ----------------------------------------------------------------------------
alter table public.defects              enable row level security;
alter table public.inspection_templates enable row level security;
alter table public.approval_rules       enable row level security;
alter table public.approval_rule_levels enable row level security;
alter table public.approval_events      enable row level security;
alter table public.escalation_rules     enable row level security;
alter table public.escalation_events    enable row level security;

create policy defects_all on public.defects for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy inspection_templates_all on public.inspection_templates for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy approval_rules_all on public.approval_rules for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy approval_rule_levels_all on public.approval_rule_levels for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy escalation_rules_all on public.escalation_rules for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());

-- Append-only, like audit_log: history is evidence.
create policy approval_events_sel on public.approval_events for select
  using (org_id = current_org_id());
create policy approval_events_ins on public.approval_events for insert
  with check (org_id = current_org_id());
create policy escalation_events_sel on public.escalation_events for select
  using (org_id = current_org_id());
create policy escalation_events_ins on public.escalation_events for insert
  with check (org_id = current_org_id());

grant select, insert, update, delete on public.defects              to assetcore_app;
grant select, insert, update, delete on public.inspection_templates to assetcore_app;
grant select, insert, update, delete on public.approval_rules       to assetcore_app;
grant select, insert, update, delete on public.approval_rule_levels to assetcore_app;
grant select, insert                 on public.approval_events      to assetcore_app;
grant select, insert, update, delete on public.escalation_rules     to assetcore_app;
grant select, insert                 on public.escalation_events    to assetcore_app;

grant execute on function public.run_escalations(uuid) to assetcore_app;
