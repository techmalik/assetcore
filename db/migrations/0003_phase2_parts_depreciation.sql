-- ============================================================================
-- AssetCore — 0003_phase2_parts_depreciation
-- Phase 2: the two missing modules, plus what a technician records on a job.
--
--   1. spare_parts / stock_movements / spare_part_assets — inventory
--   2. work_order_parts        — parts drawn from stock, replacing a JSON blob
--   3. work_order_tasks        — the checklist a job is actually worked from
--   4. work_orders             — labour, schedule and completion-report fields
--   5. depreciation_schedules / depreciation_entries — a real subledger
--   6. pm_schedules            — checklist templates and custom intervals
--   7. check_low_stock()       — nightly reorder-level notifications
--
-- Additive throughout. work_orders.parts (jsonb) and assets.photos stay for
-- now; a later phase drops them once every write path has moved.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Spare parts inventory
-- ----------------------------------------------------------------------------
create table if not exists public.spare_parts (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  part_number       text not null,
  name              text not null,
  description       text,
  category          text,
  -- Quantities are numeric, not integer: consumables are issued in litres and
  -- metres as often as in whole units.
  unit              text not null default 'each',
  unit_cost_cents   bigint not null default 0,
  quantity_in_stock numeric(12,2) not null default 0,
  reorder_level     numeric(12,2) not null default 0,
  reorder_quantity  numeric(12,2),
  supplier          text,
  storage_location  text,
  notes             text,
  active            boolean not null default true,
  created_by        uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  unique (org_id, part_number)
);
create index if not exists spare_parts_org_idx on public.spare_parts (org_id) where deleted_at is null;
create index if not exists spare_parts_low_idx on public.spare_parts (org_id, quantity_in_stock)
  where deleted_at is null and active;
create trigger spare_parts_set_updated_at before update on public.spare_parts
  for each row execute function public.set_updated_at();

-- Append-only stock ledger. `quantity` is signed (+ receipt, − issue) and
-- `balance_after` is the running total, so a stock figure can always be
-- reconciled against its history rather than trusted on its own.
create table if not exists public.stock_movements (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  part_id         uuid not null references public.spare_parts(id) on delete cascade,
  kind            text not null check (kind in ('receipt','issue','adjustment','return','consumption')),
  quantity        numeric(12,2) not null,
  balance_after   numeric(12,2) not null,
  unit_cost_cents bigint,
  reason          text,
  work_order_id   uuid references public.work_orders(id) on delete set null,
  actor_id        uuid references public.users(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists stock_movements_part_idx on public.stock_movements (part_id, created_at desc);
create index if not exists stock_movements_org_idx  on public.stock_movements (org_id, created_at desc);

-- Which assets a part fits — drives "spares for this asset" on the asset page.
create table if not exists public.spare_part_assets (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  part_id    uuid not null references public.spare_parts(id) on delete cascade,
  asset_id   uuid not null references public.assets(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (part_id, asset_id)
);
create index if not exists spare_part_assets_asset_idx on public.spare_part_assets (asset_id);

-- ----------------------------------------------------------------------------
-- 2. Work order parts — reservation and consumption
-- ----------------------------------------------------------------------------
create table if not exists public.work_order_parts (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  work_order_id     uuid not null references public.work_orders(id) on delete cascade,
  -- Null part_id = a one-off item bought for this job that isn't stocked.
  part_id           uuid references public.spare_parts(id) on delete set null,
  description       text,
  quantity_required numeric(12,2) not null default 1,
  quantity_used     numeric(12,2) not null default 0,
  -- Snapshot: what the part cost when it was used, not what it costs today.
  unit_cost_cents   bigint,
  -- Set once stock has been deducted, so closing a job twice can't double-deduct.
  consumed_at       timestamptz,
  added_by          uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint wo_parts_need_identity check (part_id is not null or description is not null)
);
create index if not exists wo_parts_wo_idx   on public.work_order_parts (work_order_id);
create index if not exists wo_parts_part_idx on public.work_order_parts (part_id);

-- ----------------------------------------------------------------------------
-- 3. Work order task checklist
-- ----------------------------------------------------------------------------
create table if not exists public.work_order_tasks (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references public.organizations(id) on delete cascade,
  work_order_id uuid not null references public.work_orders(id) on delete cascade,
  sequence      int not null default 0,
  description   text not null,
  done          boolean not null default false,
  done_by       uuid references public.users(id) on delete set null,
  done_at       timestamptz,
  notes         text,
  created_at    timestamptz not null default now()
);
create index if not exists wo_tasks_wo_idx on public.work_order_tasks (work_order_id, sequence);

-- ----------------------------------------------------------------------------
-- 4. Work orders — labour, schedule, completion report
--
-- Note on cost: the existing cost_cents column becomes explicitly the ACTUAL
-- cost, with estimated_cost_cents added alongside. No second "actual" column,
-- so there is only ever one source of truth.
-- ----------------------------------------------------------------------------
alter table public.work_orders add column if not exists estimated_hours      numeric(6,2);
alter table public.work_orders add column if not exists actual_hours         numeric(6,2);
alter table public.work_orders add column if not exists estimated_cost_cents bigint;

alter table public.work_orders add column if not exists planned_start date;
alter table public.work_orders add column if not exists planned_end   date;
alter table public.work_orders add column if not exists actual_start  timestamptz;
alter table public.work_orders add column if not exists actual_end    timestamptz;

-- Completion report — what was wrong, what was done, what was observed.
alter table public.work_orders add column if not exists completion_notes    text;
alter table public.work_orders add column if not exists root_cause          text;
alter table public.work_orders add column if not exists failure_mode        text;
alter table public.work_orders add column if not exists corrective_actions  text;
alter table public.work_orders add column if not exists safety_observations text;
alter table public.work_orders add column if not exists downtime_hours      numeric(8,2);

-- Emergency-only capture, shown on the form when type = 'emergency'.
alter table public.work_orders add column if not exists incident_type    text;
alter table public.work_orders add column if not exists discovery_method text;
alter table public.work_orders add column if not exists systems_affected text;

create index if not exists work_orders_planned_idx on public.work_orders (org_id, planned_start)
  where deleted_at is null;

-- ----------------------------------------------------------------------------
-- 5. Depreciation subledger
--
-- One active schedule per asset. Entries are ANNUAL periods: that is the
-- granularity a fixed asset register is reported at, and it keeps the maths
-- verifiable. Monthly posting is a later refinement, not a rewrite — the
-- entries table already carries opening/closing/accumulated per period.
-- ----------------------------------------------------------------------------
create table if not exists public.depreciation_schedules (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organizations(id) on delete cascade,
  asset_id            uuid not null references public.assets(id) on delete cascade,
  method              text not null
                        check (method in ('straight_line','declining_balance','sum_of_years_digits','units_of_production')),
  cost_cents          bigint not null check (cost_cents >= 0),
  salvage_value_cents bigint not null default 0 check (salvage_value_cents >= 0),
  useful_life_years   numeric(4,1) not null check (useful_life_years > 0),
  start_date          date not null,
  -- Declining balance only: 2.0 = double-declining, 1.5 = 150% declining.
  declining_factor    numeric(4,2) not null default 2.0,
  active              boolean not null default true,
  created_by          uuid references public.users(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
-- One active schedule per asset; superseded schedules stay for history.
create unique index if not exists depreciation_one_active_per_asset
  on public.depreciation_schedules (asset_id) where active;
create index if not exists depreciation_schedules_org_idx on public.depreciation_schedules (org_id);
create trigger depreciation_schedules_set_updated_at before update on public.depreciation_schedules
  for each row execute function public.set_updated_at();

create table if not exists public.depreciation_entries (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  schedule_id       uuid not null references public.depreciation_schedules(id) on delete cascade,
  asset_id          uuid not null references public.assets(id) on delete cascade,
  period_year       int not null,
  opening_cents     bigint not null,
  charge_cents      bigint not null,
  closing_cents     bigint not null,
  accumulated_cents bigint not null,
  posted            boolean not null default false,
  posted_at         timestamptz,
  posted_by         uuid references public.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (schedule_id, period_year)
);
create index if not exists depreciation_entries_asset_idx on public.depreciation_entries (asset_id, period_year);
create index if not exists depreciation_entries_org_idx   on public.depreciation_entries (org_id, period_year);

-- Where net book value comes from. 'schedule' means posted entries own it and
-- the UI must stop presenting it as a figure someone typed.
alter table public.assets
  add column if not exists nbv_source text not null default 'manual'
    check (nbv_source in ('manual','schedule'));

-- ----------------------------------------------------------------------------
-- 6. PM schedules — checklist templates and custom intervals
--
-- 0001 gave pm_tasks a checklist_results column with no checklist behind it.
-- This is the missing half: the template lives on the schedule and is copied
-- onto every task it generates.
-- ----------------------------------------------------------------------------
alter table public.pm_schedules
  add column if not exists checklist_template jsonb not null default '[]'::jsonb;
alter table public.pm_schedules add column if not exists estimated_cost_cents bigint;
-- When set, overrides `frequency` — a 45-day or 500-hour cycle has no enum.
alter table public.pm_schedules
  add column if not exists interval_days int check (interval_days is null or interval_days > 0);

-- Regenerated: copies the template onto the task and honours interval_days.
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
      v_schedule.org_id,
      v_schedule.id,
      v_schedule.asset_id,
      v_schedule.site_id,
      v_schedule.title,
      v_schedule.description,
      'pending',
      v_schedule.next_due,
      v_schedule.assignee_id,
      v_checklist
    );

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

-- ----------------------------------------------------------------------------
-- 7. Low stock notifications (node-cron: 06:30 daily)
-- ----------------------------------------------------------------------------
create or replace function public.check_low_stock(p_org_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_part  record;
  v_count int := 0;
begin
  for v_part in
    select p.id, p.org_id, p.part_number, p.name, p.quantity_in_stock, p.reorder_level, p.unit, m.user_id
    from   public.spare_parts p
    join   public.memberships m on m.org_id = p.org_id and m.status = 'active'
    where  p.deleted_at is null
      and  p.active
      and  p.reorder_level > 0
      and  p.quantity_in_stock <= p.reorder_level
      and  m.role_key in ('owner','ops_manager','maint_engineer')
      and  (p_org_id is null or p.org_id = p_org_id)
  loop
    -- One notification per person per part per day, not one per cron run.
    if exists (
      select 1 from public.notifications n
      where n.entity_id = v_part.id
        and n.user_id   = v_part.user_id
        and n.kind      = 'low_stock'
        and n.created_at::date = current_date
    ) then continue; end if;

    insert into public.notifications (org_id, user_id, kind, title, body, entity_type, entity_id)
    values (
      v_part.org_id,
      v_part.user_id,
      'low_stock',
      'Low stock: ' || v_part.name,
      -- FM strips trailing zeros but leaves the decimal point behind, so '3.00'
      -- would print as '3.' — rtrim takes the stray point off.
      v_part.part_number || ' is down to ' || rtrim(to_char(v_part.quantity_in_stock, 'FM999999990.99'), '.')
        || ' ' || v_part.unit || ' (reorder at '
        || rtrim(to_char(v_part.reorder_level, 'FM999999990.99'), '.') || ').',
      'spare_part',
      v_part.id
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Row-level security + grants
-- ----------------------------------------------------------------------------
alter table public.spare_parts             enable row level security;
alter table public.stock_movements         enable row level security;
alter table public.spare_part_assets       enable row level security;
alter table public.work_order_parts        enable row level security;
alter table public.work_order_tasks        enable row level security;
alter table public.depreciation_schedules  enable row level security;
alter table public.depreciation_entries    enable row level security;

create policy spare_parts_all on public.spare_parts for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());

-- Append-only, like audit_log: the ledger is evidence, not a working table.
create policy stock_movements_sel on public.stock_movements for select
  using (org_id = current_org_id());
create policy stock_movements_ins on public.stock_movements for insert
  with check (org_id = current_org_id());

create policy spare_part_assets_all on public.spare_part_assets for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy wo_parts_all on public.work_order_parts for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy wo_tasks_all on public.work_order_tasks for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy dep_schedules_all on public.depreciation_schedules for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy dep_entries_all on public.depreciation_entries for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());

grant select, insert, update, delete on public.spare_parts            to assetcore_app;
grant select, insert                 on public.stock_movements        to assetcore_app;
grant select, insert, update, delete on public.spare_part_assets      to assetcore_app;
grant select, insert, update, delete on public.work_order_parts       to assetcore_app;
grant select, insert, update, delete on public.work_order_tasks       to assetcore_app;
grant select, insert, update, delete on public.depreciation_schedules to assetcore_app;
grant select, insert, update, delete on public.depreciation_entries   to assetcore_app;

grant execute on function public.check_low_stock(uuid) to assetcore_app;
