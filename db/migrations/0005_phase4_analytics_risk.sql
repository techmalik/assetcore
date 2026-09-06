-- ============================================================================
-- AssetCore — 0005_phase4_analytics_risk
-- Phase 4: the numbers a manager is asked for, and the two registers behind
-- them.
--
--   1. risk_assessments        — the 5x5 matrix, inherent and residual
--   2. risk_band()             — score 1-25 -> a word people actually use
--   3. compliance_audits       — audits with an outcome, not just licences
--   4. compliance_audit_findings — what an audit found, linkable to a defect
--   5. organizations           — base and secondary currency, one stated rate
--   6. indexes                 — for the MTBF/MTTR and backlog aggregates
--
-- Additive throughout: no column is dropped or retyped, and no existing
-- constraint changes.
--
-- Nothing here computes a KPI. MTBF, MTTR and backlog-by-age are read-side
-- aggregates over work_orders as it already stands (0001 + 0003's actual_start
-- / actual_end / downtime_hours), so they are queries in apps/api rather than
-- stored figures that can drift from the rows they came from.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Risk assessments — the 5x5 matrix
--
-- 0002 gave assets a `criticality`, which is consequence only, and Phase 3's
-- health engine used it as a stand-in for risk with a note saying this would
-- supersede it. This is that: likelihood AND consequence, scored before and
-- after controls, so "we know it's bad" and "we've done something about it"
-- are different numbers.
--
-- Both scores are generated, not written: a stored product that disagrees with
-- its own factors is the kind of thing nobody notices until an auditor does.
-- ----------------------------------------------------------------------------
create table if not exists public.risk_assessments (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references public.organizations(id) on delete cascade,
  ref          text not null,                  -- RSK-2026-0001, unique per org
  asset_id     uuid references public.assets(id) on delete set null,
  site_id      uuid references public.sites(id) on delete set null,

  title        text not null,
  description  text,
  category     text not null default 'operational'
                 check (category in ('safety','environmental','operational','financial','compliance','security')),
  -- The hazard, before anything is done about it.
  likelihood   int not null check (likelihood  between 1 and 5),
  consequence  int not null check (consequence between 1 and 5),
  inherent_score int generated always as (likelihood * consequence) stored,

  -- What is in place, and what the risk is once it is.
  controls              text,
  residual_likelihood   int check (residual_likelihood  is null or residual_likelihood  between 1 and 5),
  residual_consequence  int check (residual_consequence is null or residual_consequence between 1 and 5),
  residual_score        int generated always as (residual_likelihood * residual_consequence) stored,

  owner_id     uuid references public.users(id) on delete set null,
  review_date  date,
  status       text not null default 'open'
                 check (status in ('open','mitigating','accepted','closed')),

  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz,
  unique (org_id, ref)
);
create index if not exists risk_org_status_idx on public.risk_assessments (org_id, status) where deleted_at is null;
create index if not exists risk_asset_idx      on public.risk_assessments (asset_id) where deleted_at is null;
create index if not exists risk_review_idx     on public.risk_assessments (org_id, review_date) where deleted_at is null;
create trigger risk_assessments_set_updated_at before update on public.risk_assessments
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. risk_band() — the same banding everywhere
--
-- A 5x5 grid has 25 cells and four bands. Defining the boundaries once, next
-- to licence_status(), stops the API, the reports and the matrix colouring
-- from each having their own opinion about where "high" starts.
-- ----------------------------------------------------------------------------
create or replace function public.risk_band(p_score int)
returns text language sql immutable as $$
  select case
    when p_score is null then null
    when p_score >= 16 then 'extreme'
    when p_score >= 11 then 'high'
    when p_score >= 6  then 'medium'
    else 'low'
  end
$$;

-- ----------------------------------------------------------------------------
-- 3. Compliance audits
--
-- 0001 tracked licences — documents with an expiry date. An audit is the other
-- half of compliance: someone comes and checks, and it ends in an outcome.
-- Without the outcome an audit is just a diary entry.
-- ----------------------------------------------------------------------------
create table if not exists public.compliance_audits (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  ref            text not null,                -- AUD-2026-0001, unique per org
  title          text not null,
  kind           text not null default 'internal'
                   check (kind in ('internal','external','regulatory','certification')),
  authority_id   uuid references public.regulatory_authorities(id) on delete set null,
  site_id        uuid references public.sites(id) on delete set null,
  licence_id     uuid references public.compliance_licences(id) on delete set null,
  scope          text,
  auditor        text,                          -- often an external firm, so text
  lead_id        uuid references public.users(id) on delete set null,
  scheduled_date date not null,
  completed_date date,
  status         text not null default 'scheduled'
                   check (status in ('scheduled','in_progress','completed','cancelled')),
  -- The outcome, and the reason there is one. Null until completed; the API
  -- refuses to complete an audit without it, the way an inspection now needs
  -- its condition rating.
  outcome        text check (outcome in ('pass','pass_with_findings','fail','not_applicable')),
  summary        text,
  next_due_date  date,
  created_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  unique (org_id, ref)
);
create index if not exists audits_org_status_idx on public.compliance_audits (org_id, status) where deleted_at is null;
create index if not exists audits_date_idx       on public.compliance_audits (org_id, scheduled_date) where deleted_at is null;
create trigger compliance_audits_set_updated_at before update on public.compliance_audits
  for each row execute function public.set_updated_at();

-- A finding is a non-conformity against a clause. Like an inspection finding,
-- it can become a defect — and from there a work order — so the audit trail
-- runs all the way from "the regulator wrote this down" to "we fixed it".
create table if not exists public.compliance_audit_findings (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  audit_id    uuid not null references public.compliance_audits(id) on delete cascade,
  clause      text,                              -- e.g. "ISO 55001 §8.2"
  description text not null,
  severity    text not null default 'minor'
                check (severity in ('observation','minor','major','critical')),
  status      text not null default 'open'
                check (status in ('open','closed')),
  defect_id   uuid references public.defects(id) on delete set null,
  due_date    date,
  closed_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists audit_findings_audit_idx  on public.compliance_audit_findings (audit_id);
create index if not exists audit_findings_defect_idx on public.compliance_audit_findings (defect_id);

-- ----------------------------------------------------------------------------
-- 4. Currency
--
-- Every money column in this schema is integer minor units, and every one of
-- them is in the org's base currency — that does not change. The secondary
-- currency is presentation only: a stated rate, with the date it was stated,
-- shown beside the real figure.
--
-- Deliberately not a live FX feed. An on-prem instance may have no outbound
-- internet at all, and a converted figure whose rate nobody can point at is
-- worse than no converted figure.
-- ----------------------------------------------------------------------------
alter table public.organizations
  add column if not exists base_currency text not null default 'NGN'
    check (char_length(base_currency) = 3);
alter table public.organizations add column if not exists secondary_currency text
  check (secondary_currency is null or char_length(secondary_currency) = 3);
-- Units of secondary per 1 base. 6dp carries a NGN->USD rate without rounding
-- the meaning out of it.
alter table public.organizations add column if not exists fx_rate numeric(18,6)
  check (fx_rate is null or fx_rate > 0);
alter table public.organizations add column if not exists fx_rate_at date;

-- ----------------------------------------------------------------------------
-- 5. Indexes for the KPI aggregates
--
-- MTBF and MTTR read closed corrective/emergency jobs by date; backlog-by-age
-- reads open ones by creation date. Both scan the whole table without these.
-- ----------------------------------------------------------------------------
create index if not exists work_orders_kpi_idx
  on public.work_orders (org_id, type, actual_end)
  where deleted_at is null;
create index if not exists work_orders_backlog_idx
  on public.work_orders (org_id, created_at)
  where deleted_at is null and status <> 'closed';

-- ----------------------------------------------------------------------------
-- 6. Row-level security + grants
-- ----------------------------------------------------------------------------
alter table public.risk_assessments          enable row level security;
alter table public.compliance_audits         enable row level security;
alter table public.compliance_audit_findings enable row level security;

create policy risk_assessments_all on public.risk_assessments for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy compliance_audits_all on public.compliance_audits for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy audit_findings_all on public.compliance_audit_findings for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());

grant select, insert, update, delete on public.risk_assessments          to assetcore_app;
grant select, insert, update, delete on public.compliance_audits         to assetcore_app;
grant select, insert, update, delete on public.compliance_audit_findings to assetcore_app;

grant execute on function public.risk_band(int) to assetcore_app;
