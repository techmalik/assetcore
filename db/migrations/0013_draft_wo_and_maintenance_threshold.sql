-- ============================================================================
-- 0013_draft_wo_and_maintenance_threshold
-- Two changes to the health-crossing automation, per owner review:
--
-- 1. Auto-generated work orders now land in a real `draft` status instead of
--    `new`. The spec says the system "drafts" a work order at the maintenance
--    threshold — draft makes that literal: a system-proposed WO that a
--    planner explicitly approves (draft -> new) before it enters the normal
--    workflow. Human-created WOs still start at `new`; nothing else changes
--    about the lifecycle.
--
-- 2. The maintenance/auto-WO threshold (previously fixed at 30) becomes
--    admin-configurable via organizations.settings->'health'->>
--    'maintenanceThreshold', exactly like the inspection threshold added in
--    0003/0007. Defaults to 30, so orgs that never touch the setting keep
--    today's behaviour. The Admin UI clamps it below the inspection
--    threshold so the two bands can't overlap.
-- ============================================================================

alter table public.work_orders drop constraint work_orders_status_check;
alter table public.work_orders add constraint work_orders_status_check
  check (status in ('draft', 'new', 'assigned', 'in_progress', 'awaiting_parts', 'inspection', 'closed'));

create or replace function public.apply_asset_health(p_asset_id uuid, p_new_health int, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset     record;
  v_threshold int;
  v_maint     int;
  v_new       int := greatest(0, least(100, p_new_health));
  v_ref       text;
begin
  select a.id, a.org_id, a.name, a.site_id, a.health_score, a.assigned_operator_id,
         coalesce((o.settings->'health'->>'inspectionThreshold')::int, 50) as insp_threshold,
         coalesce((o.settings->'health'->>'maintenanceThreshold')::int, 30) as maint_threshold
  into v_asset
  from public.assets a
  join public.organizations o on o.id = a.org_id
  where a.id = p_asset_id and a.deleted_at is null
  for update of a;

  if not found then
    return;
  end if;

  v_threshold := v_asset.insp_threshold;
  v_maint     := v_asset.maint_threshold;

  -- Inspection: crossing down through the configurable threshold. Creates a
  -- real inspection record (not just a notification) so it shows up as an
  -- actionable item on the Inspections page, deduped like the auto-WO below.
  if coalesce(v_asset.health_score, 100) > v_threshold and v_new <= v_threshold then
    if not exists (
      select 1 from public.inspections i
      where i.asset_id = v_asset.id and i.status in ('scheduled', 'due', 'in_progress')
        and i.title like 'Auto:%'
    ) then
      insert into public.inspections (org_id, site_id, asset_id, kind, title, status, scheduled_date)
      values (v_asset.org_id, v_asset.site_id, v_asset.id, 'condition',
              'Auto: health at ' || v_new || '% — condition inspection required',
              'due', current_date + 7);
    end if;

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

    insert into public.asset_activity (org_id, asset_id, user_id, kind, body)
    values (v_asset.org_id, v_asset.id, p_actor, 'alert',
            'Inspection alert: health fell to ' || v_new || '% (threshold ' || v_threshold || '%).');
  end if;

  -- Maintenance alert + auto work order: crossing down through the
  -- configurable maintenance threshold (default 30).
  if coalesce(v_asset.health_score, 100) > v_maint and v_new <= v_maint then
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
      v_ref := public.next_wo_ref(v_asset.org_id);

      insert into public.work_orders (org_id, site_id, asset_id, ref, title, description, type, status, priority)
      values (v_asset.org_id, v_asset.site_id, v_asset.id, v_ref,
              'Auto: health critical — ' || v_asset.name,
              'Auto-drafted because asset health fell to ' || v_new || '%. Review and approve.',
              'corrective', 'draft', 'high');

      insert into public.asset_activity (org_id, asset_id, user_id, kind, body)
      values (v_asset.org_id, v_asset.id, p_actor, 'alert',
              'Maintenance alert: health fell to ' || v_new || '%. Work order ' || v_ref || ' auto-drafted.');
    end if;
  end if;

  update public.assets set health_score = v_new where id = v_asset.id;
end;
$$;

grant execute on function public.apply_asset_health(uuid, int, uuid) to assetcore_app;
