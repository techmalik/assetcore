-- ============================================================================
-- 0003_health_lifecycle
-- Health-driven automation: a daily job decays each maintained asset's health
-- from 100 (at last maintenance) toward 0 (at next maintenance); crossing the
-- configurable inspection threshold raises an inspection alert, and crossing 30
-- raises a red maintenance alert AND auto-drafts a work order. Plus report-file
-- columns for inspections and PM tasks.
-- ============================================================================

alter table public.inspections add column if not exists report_url text;
alter table public.pm_tasks    add column if not exists report_url text;

-- ----------------------------------------------------------------------------
-- recompute_asset_health — node-cron: 01:00 daily (see apps/api/src/jobs.ts).
-- Only touches assets that have BOTH maintenance dates set (manually-scored
-- assets are left alone). Alerts fire once, on the downward crossing.
-- ----------------------------------------------------------------------------
create or replace function public.recompute_asset_health(p_org_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset     record;
  v_threshold int;
  v_new       int;
  v_count     int := 0;
  v_ref       text;
  v_year      int := extract(year from current_date)::int;
begin
  for v_asset in
    select a.id, a.org_id, a.name, a.site_id, a.health_score, a.assigned_operator_id,
           a.last_maintenance_at, a.next_maintenance_at,
           coalesce((o.settings->'health'->>'inspectionThreshold')::int, 50) as insp_threshold
    from public.assets a
    join public.organizations o on o.id = a.org_id
    where a.deleted_at is null
      and a.last_maintenance_at is not null
      and a.next_maintenance_at is not null
      and a.next_maintenance_at > a.last_maintenance_at
      and (p_org_id is null or a.org_id = p_org_id)
  loop
    v_threshold := v_asset.insp_threshold;
    v_new := greatest(0, least(100, round(
      100.0 * (v_asset.next_maintenance_at - current_date)
            / (v_asset.next_maintenance_at - v_asset.last_maintenance_at)
    )::int));

    -- Inspection alert: crossing down through the configurable threshold.
    if coalesce(v_asset.health_score, 100) > v_threshold and v_new <= v_threshold then
      insert into public.notifications (org_id, user_id, kind, title, body, entity_type, entity_id)
      select v_asset.org_id, m.user_id, 'inspection_due',
             'Inspection due: ' || v_asset.name,
             'Health has fallen to ' || v_new || '%. Schedule an inspection.',
             'asset', v_asset.id
      from public.memberships m
      where m.org_id = v_asset.org_id and m.status = 'active'
        and m.role_key in ('owner', 'ops_manager', 'hse_officer')
      union
      select v_asset.org_id, v_asset.assigned_operator_id, 'inspection_due',
             'Inspection due: ' || v_asset.name,
             'Health has fallen to ' || v_new || '%. Schedule an inspection.',
             'asset', v_asset.id
      where v_asset.assigned_operator_id is not null;

      insert into public.asset_activity (org_id, asset_id, kind, body)
      values (v_asset.org_id, v_asset.id, 'alert',
              'Inspection alert: health fell to ' || v_new || '% (threshold ' || v_threshold || '%).');
    end if;

    -- Maintenance alert + auto work order: crossing down through 30.
    if coalesce(v_asset.health_score, 100) > 30 and v_new <= 30 then
      insert into public.notifications (org_id, user_id, kind, title, body, entity_type, entity_id)
      select v_asset.org_id, m.user_id, 'maintenance_due',
             'Maintenance required: ' || v_asset.name,
             'Health critical at ' || v_new || '%. A work order has been drafted.',
             'asset', v_asset.id
      from public.memberships m
      where m.org_id = v_asset.org_id and m.status = 'active'
        and m.role_key in ('owner', 'ops_manager', 'maint_engineer');

      if not exists (
        select 1 from public.work_orders w
        where w.asset_id = v_asset.id and w.deleted_at is null and w.status <> 'closed'
          and w.type = 'corrective' and w.title like 'Auto:%'
      ) then
        select 'WO-' || v_year || '-' || lpad((count(*) + 1)::text, 4, '0')
        into v_ref
        from public.work_orders
        where org_id = v_asset.org_id and ref like 'WO-' || v_year || '-%';

        insert into public.work_orders (org_id, site_id, asset_id, ref, title, description, type, status, priority)
        values (v_asset.org_id, v_asset.site_id, v_asset.id, v_ref,
                'Auto: health critical — ' || v_asset.name,
                'Auto-drafted because asset health fell to ' || v_new || '%. Review and assign.',
                'corrective', 'new', 'high');

        insert into public.asset_activity (org_id, asset_id, kind, body)
        values (v_asset.org_id, v_asset.id, 'alert',
                'Maintenance alert: health fell to ' || v_new || '%. Work order ' || v_ref || ' auto-drafted.');
      end if;
    end if;

    update public.assets set health_score = v_new where id = v_asset.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.recompute_asset_health(uuid) to assetcore_app;
