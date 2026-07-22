-- ============================================================================
-- 0012_asset_status_expansion
-- TASK-4.2: `assets.status` (0001:169) could only express
-- operational/attention/critical/offline — no way to represent "under
-- maintenance" or "standby", real operational states distinct from
-- health-derived severity (attention/critical describe HOW HEALTHY an
-- asset is; maintenance/standby describe WHAT IT'S DOING right now).
--
-- Expands the check constraint to accept both the legacy values (existing
-- rows keep rendering and stay editable — nothing is migrated/renamed) and
-- the two new ones. No column type change, no data migration needed.
-- ============================================================================

alter table public.assets drop constraint assets_status_check;

alter table public.assets add constraint assets_status_check
  check (status in ('operational', 'maintenance', 'standby', 'offline', 'attention', 'critical'));
