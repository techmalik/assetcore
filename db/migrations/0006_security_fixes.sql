-- ============================================================================
-- 0006_security_fixes
-- TASK-1.2: compliance_audits allowed a site-scoped caller to create or edit
-- audits for sites outside their scope. The SELECT policy applied the usual
-- site-scope predicate, but INSERT checked only org_id, and UPDATE had a
-- `using` clause but no `with check` at all — so a scoped user could insert
-- (or, post-update, leave) a row pointing at any site in the org.
--
-- Fix: give INSERT and UPDATE the same predicate as SELECT, on both `using`
-- and `with check`. compliance_audits deliberately treats site_id is null as
-- an org-wide audit visible/writable by everyone (unlike assets/pm_tasks/etc,
-- which have no such carve-out) — preserved here to match existing SELECT
-- behaviour and the audit form, which allows creating an audit with no site.
-- ============================================================================

drop policy if exists comp_audits_ins on public.compliance_audits;
create policy comp_audits_ins on public.compliance_audits for insert
  with check (org_id = current_org_id() and (current_site_ids() is null or site_id is null or site_id = any(current_site_ids())));

drop policy if exists comp_audits_upd on public.compliance_audits;
create policy comp_audits_upd on public.compliance_audits for update
  using (org_id = current_org_id() and (current_site_ids() is null or site_id is null or site_id = any(current_site_ids())))
  with check (org_id = current_org_id() and (current_site_ids() is null or site_id is null or site_id = any(current_site_ids())));
