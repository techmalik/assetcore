-- ============================================================================
-- 0028 — Person-routed ("direct") approvals and line managers
--
-- 0023 routes a request to a ROLE through the approval matrix: anyone holding
-- that role can sign. That fits spend bands, but not how most sign-off
-- actually happens on site: a technician sends a job or a report to their own
-- manager, who accepts it, sends it further up, hands it back, or throws it
-- out. So a request can now also sit with one named person.
--
--   memberships.manager_id   — a member's line manager, so the picker can
--                              preselect the obvious person.
--   approvals.route          — 'rule' (0023's matrix) or 'direct' (a person).
--   approvals.assignee_id    — who a direct request is currently with.
--   returned / discarded     — two outcomes a matrix request never had:
--                              "fix this and send it back", and "this is not
--                              going anywhere" (kept, not deleted).
--   forwarded / returned /
--   discarded / resubmitted  — the history of a request that moves between
--                              people rather than up levels.
--
-- The rule flow is untouched: every existing row defaults to route 'rule'.
-- run_escalations() (0023) reads approvals with status = 'pending' only, so
-- the new terminal statuses cannot trip an escalation.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Line managers
-- ----------------------------------------------------------------------------
-- References users, not memberships: a manager is a person, and set null on
-- delete so removing a user never cascades into their reports' memberships.
alter table public.memberships
  add column if not exists manager_id uuid references public.users(id) on delete set null;

-- Nobody manages themselves. The API also refuses a direct two-person loop;
-- longer cycles are not worth a recursive check at write time, because the
-- only thing a manager does is preselect a name in a picker.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'memberships_manager_not_self') then
    alter table public.memberships
      add constraint memberships_manager_not_self check (manager_id is null or manager_id <> user_id);
  end if;
end $$;

create index if not exists memberships_manager_idx on public.memberships (org_id, manager_id)
  where manager_id is not null;

-- ----------------------------------------------------------------------------
-- 2. Direct routing on approvals
-- ----------------------------------------------------------------------------
alter table public.approvals
  add column if not exists route text not null default 'rule';
alter table public.approvals
  add column if not exists assignee_id uuid references public.users(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'approvals_route_check') then
    alter table public.approvals
      add constraint approvals_route_check check (route in ('rule','direct'));
  end if;
end $$;

-- returned  — handed back to the requester to fix and resubmit; not final.
-- discarded — concluded without acceptance; the record stays as evidence.
alter table public.approvals drop constraint if exists approvals_status_check;
alter table public.approvals add constraint approvals_status_check
  check (status in ('pending','approved','rejected','recalled','returned','discarded'));

-- "What is waiting on me?" for direct requests is a lookup on the assignee,
-- the counterpart of 0023's approvals_pending_on_idx for role-routed ones.
create index if not exists approvals_pending_assignee_idx
  on public.approvals (org_id, assignee_id) where status = 'pending';

-- ----------------------------------------------------------------------------
-- 3. History
-- ----------------------------------------------------------------------------
alter table public.approval_events drop constraint if exists approval_events_action_check;
alter table public.approval_events add constraint approval_events_action_check
  check (action in ('submitted','approved','rejected','recalled',
                    'forwarded','returned','discarded','resubmitted'));

-- Who a submit, forward or resubmit sent the request to. Null for actions
-- that don't move it to anyone.
alter table public.approval_events
  add column if not exists to_user_id uuid references public.users(id) on delete set null;
