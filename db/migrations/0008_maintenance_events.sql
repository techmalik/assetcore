-- ============================================================================
-- 0008_maintenance_events
-- TASK-E1.1: explicit "Complete Maintenance" action. Today, only completing a
-- PM task resets an asset's health to 100% and advances its maintenance
-- dates (pmTasks.ts) — closing a work order, including the auto-drafted
-- corrective ones the 30% health trigger creates, does nothing to health at
-- all. That breaks the loop the requirements describe: health drops to 30%,
-- a work order is auto-drafted, someone does the repair and closes it — and
-- the asset just stays at whatever health it was, forever, because closing a
-- WO was never wired to a health reset.
--
-- Deliberately NOT "reset health whenever a work order closes" — work orders
-- close for lots of reasons (duplicate, cancelled, deferred) that have
-- nothing to do with maintenance actually being performed. Instead: a
-- dedicated maintenance_events record, created through an explicit
-- completion action (apps/api/src/routes/maintenanceEvents.ts), optionally
-- linked to the PM task or work order it closes out. PM-task completion
-- (pmTasks.ts) is refactored in a later task to go through this same table
-- so there's exactly one code path that resets health.
-- ============================================================================

create table if not exists public.maintenance_events (
  id                   uuid primary key default gen_random_uuid(),
  org_id               uuid not null references public.organizations(id) on delete cascade,
  site_id              uuid references public.sites(id) on delete set null,
  asset_id             uuid not null references public.assets(id) on delete cascade,
  source               text not null default 'manual'
                         check (source in ('pm_task', 'work_order', 'manual')),
  pm_task_id           uuid references public.pm_tasks(id) on delete set null,
  work_order_id        uuid references public.work_orders(id) on delete set null,
  completed_at         date not null,
  next_maintenance_at  date not null,
  notes                text,
  report_url           text,
  performed_by         uuid references public.users(id) on delete set null,
  created_at           timestamptz not null default now(),
  constraint maintenance_events_dates_chk check (next_maintenance_at > completed_at)
);
create index if not exists maintenance_events_asset_idx on public.maintenance_events (asset_id, completed_at desc);
create index if not exists maintenance_events_org_idx on public.maintenance_events (org_id);

alter table public.maintenance_events enable row level security;

-- Same site-scope predicate as the other site-bearing tenant tables (assets,
-- work_orders, ...): NULL scope (all-site caller) or a NULL site_id (org-wide
-- event) is visible/writable by anyone in the org; otherwise the caller's
-- site_ids must include the event's site.
create policy maint_events_sel on public.maintenance_events for select
  using (org_id = current_org_id() and (current_site_ids() is null or site_id is null or site_id = any(current_site_ids())));
create policy maint_events_ins on public.maintenance_events for insert
  with check (org_id = current_org_id() and (current_site_ids() is null or site_id is null or site_id = any(current_site_ids())));

grant select, insert on public.maintenance_events to assetcore_app;
