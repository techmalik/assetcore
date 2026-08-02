-- ============================================================================
-- 0018_audit_entity_labels
-- Owner review: "in the audit log the activities are written, but it is not
-- actually understandable what activity was done unless you trace the ref
-- number to the task."
--
-- Accurate. audit_log has ten columns and not one of them is a human name, so
-- the Admin tab could only render what it had: a raw action string, a raw
-- entity_type, and `entity_id.slice(0, 8)` — the first eight hex characters of
-- a UUID. Not even the whole UUID, so it could not be pasted into a lookup.
--
-- Fix: store a human label ON the audit row, resolved once when the row is
-- written. Snapshot rather than a read-time join, deliberately:
--
--   * an audit log is a historical record — if a work order is renamed, the
--     entry describing last month's event should still read as it did then;
--   * asset_categories are HARD deleted (routes/categories.ts), so a
--     `category.delete` row's join target is destroyed at exactly the moment
--     the entry becomes interesting. A read-time join can never recover that
--     name; a snapshot already has it.
--
-- resolve_audit_label() is used by both the backfill below and by
-- writeAuditLog() (apps/api/src/audit.ts), which calls it inline in its INSERT
-- so there is one implementation and no extra round trip.
-- ============================================================================

alter table public.audit_log add column if not exists entity_label text;

-- The per-asset activity feed filters `entity_type = 'asset' and entity_id = $1`
-- (routes/assets.ts) against an index that does not exist — audit_log has only
-- (org_id, created_at desc). Every asset timeline load seq-scans the log.
create index if not exists audit_log_entity_idx on public.audit_log (entity_type, entity_id);

-- ----------------------------------------------------------------------------
-- resolve_audit_label — polymorphic lookup of a human label for an audit row.
--
-- security definer because it reads across tenant tables the acting user may
-- not be site-scoped to; every lookup is constrained by p_org_id so it cannot
-- be used to read a label out of another organisation.
--
-- Returns null rather than raising when nothing can be found — a missing label
-- degrades to the UI showing the entity type alone, which is still better than
-- a truncated UUID.
-- ----------------------------------------------------------------------------
create or replace function public.resolve_audit_label(
  p_org_id      uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_before      jsonb default null,
  p_after       jsonb default null
)
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_label text;
begin
  if p_entity_id is not null then
    case p_entity_type

      when 'work_order' then
        select w.ref || ' — ' || w.title into v_label
        from public.work_orders w where w.id = p_entity_id and w.org_id = p_org_id;

      when 'asset' then
        select a.ain || ' — ' || a.name into v_label
        from public.assets a where a.id = p_entity_id and a.org_id = p_org_id;

      -- Titles repeat across cycles of the same schedule ("Quarterly
      -- Calibration" every quarter), so the due date is part of the identity.
      when 'pm_task' then
        select t.title || ' (due ' || to_char(t.due_date, 'DD Mon YYYY') || ')' into v_label
        from public.pm_tasks t where t.id = p_entity_id and t.org_id = p_org_id;

      when 'pm_schedule' then
        select s.title into v_label
        from public.pm_schedules s where s.id = p_entity_id and s.org_id = p_org_id;

      when 'inspection' then
        select i.title into v_label
        from public.inspections i where i.id = p_entity_id and i.org_id = p_org_id;

      when 'compliance_licence' then
        select l.name || coalesce(' (' || l.licence_number || ')', '') into v_label
        from public.compliance_licences l where l.id = p_entity_id and l.org_id = p_org_id;

      when 'compliance_audit' then
        select ca.title into v_label
        from public.compliance_audits ca where ca.id = p_entity_id and ca.org_id = p_org_id;

      when 'site' then
        select s.name into v_label
        from public.sites s where s.id = p_entity_id and s.org_id = p_org_id;

      when 'location' then
        select l.name into v_label
        from public.locations l where l.id = p_entity_id and l.org_id = p_org_id;

      when 'asset_category' then
        select c.name into v_label
        from public.asset_categories c where c.id = p_entity_id and c.org_id = p_org_id;

      when 'device' then
        select d.name || coalesce(' (' || d.serial_number || ')', '') into v_label
        from public.devices d where d.id = p_entity_id and d.org_id = p_org_id;

      -- maintenance_events has no title, name or ref of any kind, so the label
      -- has to be synthesised from the asset the completion belongs to.
      when 'maintenance_event' then
        select 'Maintenance on ' || a.ain || ' — ' || a.name into v_label
        from public.maintenance_events me
        join public.assets a on a.id = me.asset_id
        where me.id = p_entity_id and me.org_id = p_org_id;

      -- entity_id is a memberships.id for user.role/access/disable/enable/
      -- reset_password, but a users.id for user.invite (routes/orgMembers.ts).
      -- A single join silently returns nothing for every invite, so try both.
      when 'membership' then
        select u.full_name into v_label
        from public.memberships m
        join public.users u on u.id = m.user_id
        where m.id = p_entity_id and m.org_id = p_org_id;

        if v_label is null then
          select u.full_name into v_label
          from public.memberships m
          join public.users u on u.id = m.user_id
          where m.user_id = p_entity_id and m.org_id = p_org_id
          limit 1;
        end if;

      else
        v_label := null;
    end case;
  end if;

  -- The row is already gone (hard delete, or a cascade), or the type is one we
  -- don't know. Every `.create` action stores the whole row in `after`, so
  -- those remain self-describing with no table to join at all.
  if v_label is null then
    v_label := coalesce(
      nullif(trim(coalesce(p_after->>'ref', p_after->>'ain', '') || ' ' ||
                  coalesce(p_after->>'name', p_after->>'title', '')), ''),
      nullif(trim(coalesce(p_before->>'ref', p_before->>'ain', '') || ' ' ||
                  coalesce(p_before->>'name', p_before->>'title', '')), '')
    );
  end if;

  return v_label;
end;
$$;

grant execute on function public.resolve_audit_label(uuid, text, uuid, jsonb, jsonb) to assetcore_app;

-- ----------------------------------------------------------------------------
-- Backfill, so the log is readable retroactively rather than only from the
-- deploy forward. Uses the same function the write path uses, so there is no
-- second copy of the logic to drift.
-- ----------------------------------------------------------------------------
update public.audit_log al
set entity_label = public.resolve_audit_label(al.org_id, al.entity_type, al.entity_id, al.before, al.after)
where al.entity_label is null;
