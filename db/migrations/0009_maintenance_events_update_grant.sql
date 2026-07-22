-- ============================================================================
-- 0009_maintenance_events_update_grant
-- 0008 granted only select/insert on maintenance_events and defined only
-- SELECT/INSERT policies. POST /maintenance-completions/:id/report (added in
-- the same task) needs UPDATE to attach a report after the fact — caught by
-- a live end-to-end test ("permission denied for table maintenance_events"),
-- not by the build, since RLS/grant gaps don't surface at compile time.
-- ============================================================================

create policy maint_events_upd on public.maintenance_events for update
  using (org_id = current_org_id() and (current_site_ids() is null or site_id is null or site_id = any(current_site_ids())))
  with check (org_id = current_org_id() and (current_site_ids() is null or site_id is null or site_id = any(current_site_ids())));

grant update on public.maintenance_events to assetcore_app;
