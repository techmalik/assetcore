-- ============================================================================
-- 0010_notification_hardening
-- TASK-2.7: check_licence_expiry() required an EXACT match on days-to-expiry
-- (90, 30, or 7) before sending anything. If the daily cron missed a single
-- run — a deploy, a restart, a maintenance window — that milestone's alert
-- was gone forever; there was no next-run catch-up. Recipients were also
-- hardcoded to owner/ops_manager with no site-scope check at all (a
-- Lagos-scoped ops_manager, if one existed, was alerted about every site's
-- licences org-wide), hse_officer (who owns compliance in the app's own role
-- matrix) was never notified at all, and nothing consulted
-- notification_preferences — a user who'd turned off licence_expiry alerts
-- got them anyway.
-- ============================================================================

alter table public.notifications add column if not exists dedupe_key text;
create unique index if not exists notifications_dedupe_uidx
  on public.notifications (org_id, dedupe_key) where dedupe_key is not null;

create or replace function public.check_licence_expiry(p_org_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lic       record;
  v_member    record;
  v_days      int;
  v_milestone int;
  v_pref      boolean;
  v_inserted  int;
  v_count     int := 0;
begin
  for v_lic in
    select cl.id, cl.org_id, cl.site_id, cl.name, cl.expiry_date
    from public.compliance_licences cl
    where cl.deleted_at is null
      and cl.expiry_date >= current_date
      and cl.expiry_date <= current_date + interval '90 days'
      and (p_org_id is null or cl.org_id = p_org_id)
  loop
    v_days := v_lic.expiry_date - current_date;

    -- Every milestone at or past due, not just the exact one for today — if
    -- a run was missed and multiple thresholds were crossed since, each
    -- still-unsent one fires once (the dedupe key, keyed by milestone, is
    -- what makes each idempotent across runs).
    foreach v_milestone in array array[90, 30, 7] loop
      if v_days > v_milestone then continue; end if;

      for v_member in
        select m.user_id
        from public.memberships m
        where m.org_id = v_lic.org_id and m.status = 'active'
          and m.role_key in ('owner', 'ops_manager', 'hse_officer')
          and (
            -- Unscoped staff (both null) see every site; an org-wide
            -- licence (site_id null) is visible to everyone regardless of
            -- their own scope — same carve-out compliance records use
            -- elsewhere (0006_security_fixes.sql).
            (m.site_scope is null and m.location_scope is null)
            or v_lic.site_id is null
            or v_lic.site_id = any(coalesce(m.site_scope, '{}'))
            or exists (
                 select 1 from public.sites s
                 where s.id = v_lic.site_id and s.location_id = any(coalesce(m.location_scope, '{}'))
               )
          )
      loop
        select coalesce(np.in_app, true) into v_pref
        from public.notification_preferences np
        where np.org_id = v_lic.org_id and np.user_id = v_member.user_id and np.kind = 'licence_expiry';
        if v_pref is null then v_pref := true; end if; -- no row = default on
        if not v_pref then continue; end if;

        insert into public.notifications (org_id, user_id, kind, title, body, entity_type, entity_id, dedupe_key)
        values (
          v_lic.org_id, v_member.user_id, 'licence_expiry',
          'Licence expiring in ' || v_milestone || ' days: ' || v_lic.name,
          'Expires ' || to_char(v_lic.expiry_date, 'DD Mon YYYY') || '. Renew to maintain compliance.',
          'compliance_licence', v_lic.id,
          'licence_expiry:' || v_lic.id || ':' || v_member.user_id || ':' || v_milestone
        )
        on conflict (org_id, dedupe_key) where dedupe_key is not null do nothing;
        get diagnostics v_inserted = row_count;
        v_count := v_count + v_inserted;
      end loop;
    end loop;
  end loop;
  return v_count;
end;
$$;

grant execute on function public.check_licence_expiry(uuid) to assetcore_app;
