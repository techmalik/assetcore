-- ============================================================================
-- AssetCore — 0007_service_role_grants
-- In Supabase local dev, newly created tables do NOT automatically get DML
-- grants for the service_role PostgreSQL role. service_role bypasses RLS
-- (row_security = off) but still needs object-level SELECT/INSERT/UPDATE/DELETE.
-- This migration grants those privileges so the admin-api Edge Function (which
-- connects with the service-role key) can perform cross-org operations.
-- ============================================================================

grant select, insert, update, delete on
  public.organizations,
  public.profiles,
  public.memberships,
  public.assets,
  public.work_orders,
  public.sites,
  public.audit_log,
  public.compliance_licences,
  public.roles,
  public.asset_categories,
  public.inspections,
  public.approvals,
  public.pm_schedules,
  public.pm_tasks,
  public.reports,
  public.notifications,
  public.notification_preferences,
  public.work_order_activity
to service_role;
