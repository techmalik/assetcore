-- ============================================================================
-- 0024_risk_audits_currency
--
--   1. risk_assessments  — the 5x5 matrix, inherent and residual
--   2. risk_band()       — score 1-25 -> a word people actually use
--   3. compliance_audits — MERGED, see below
--   4. compliance_audit_findings — what an audit found, linkable to a defect
--   5. organizations     — base and secondary currency, one stated rate
--   6. indexes           — for the MTBF/MTTR and backlog aggregates
--
-- On compliance_audits, both branches built a table of that name and they are
-- not the same thing:
--
--   0005 built an ISO questionnaire record — standard, iso_reference,
--   routine_maintenance_complied, iso_audit_conducted, answers jsonb. It
--   captures what an ISO audit ASKED and what was answered.
--
--   The other branch built an audit lifecycle — scheduled -> in progress ->
--   completed, ending in an outcome, with findings as child rows that can be
--   pushed onto the defect register.
--
-- Neither supersedes the other, so this migration extends 0005's table with
-- the lifecycle rather than replacing it. The result answers both "what did
-- the auditor ask" and "did we pass, and what is still open", which neither
-- table could do alone. Existing rows are backfilled as completed, since a
-- row in the 0005 shape only ever recorded an audit that had happened.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Risk assessments — the 5x5 matrix
--
-- 0021 gave assets a `criticality`, which is consequence only. This is
-- likelihood AND consequence, scored before and after controls, so "we know
-- it's bad" and "we've done something about it" are different numbers.
--
-- Both scores are generated, not written: a stored product that disagrees
-- with its own factors is the kind of thing nobody notices until an auditor
-- does.
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
  likelihood   int not null check (likelihood  between 1 and 5),
  consequence  int not null check (consequence between 1 and 5),
  inherent_score int generated always as (likelihood * consequence) stored,

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
-- 3. compliance_audits — the lifecycle half
-- ----------------------------------------------------------------------------
alter table public.compliance_audits add column if not exists ref  text;
alter table public.compliance_audits add column if not exists kind text not null default 'internal';
alter table public.compliance_audits add column if not exists authority_id uuid references public.regulatory_authorities(id) on delete set null;
alter table public.compliance_audits add column if not exists licence_id uuid references public.compliance_licences(id) on delete set null;
alter table public.compliance_audits add column if not exists scope text;
alter table public.compliance_audits add column if not exists auditor text;
alter table public.compliance_audits add column if not exists lead_id uuid references public.users(id) on delete set null;
alter table public.compliance_audits add column if not exists scheduled_date date;
alter table public.compliance_audits add column if not exists completed_date date;
alter table public.compliance_audits add column if not exists status text not null default 'scheduled';
alter table public.compliance_audits add column if not exists outcome text;
alter table public.compliance_audits add column if not exists summary text;
alter table public.compliance_audits add column if not exists next_due_date date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'compliance_audits_kind_check') then
    alter table public.compliance_audits add constraint compliance_audits_kind_check
      check (kind in ('internal','external','regulatory','certification'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'compliance_audits_status_check') then
    alter table public.compliance_audits add constraint compliance_audits_status_check
      check (status in ('scheduled','in_progress','completed','cancelled'));
  end if;
  -- Null until completed. The API refuses to complete an audit without one,
  -- the same rule 0023 gave inspections and their condition rating: a
  -- compliance record with a blank result is a diary entry.
  if not exists (select 1 from pg_constraint where conname = 'compliance_audits_outcome_check') then
    alter table public.compliance_audits add constraint compliance_audits_outcome_check
      check (outcome is null or outcome in ('pass','pass_with_findings','fail','not_applicable'));
  end if;
end $$;

-- Backfill: a row in the 0005 shape only ever recorded an audit that had
-- already been carried out, so it is completed, on its audit_date. The
-- outcome is left null on purpose — it was never captured, and inventing
-- "pass" for historic rows would be a claim nobody made.
update public.compliance_audits
set scheduled_date = coalesce(scheduled_date, audit_date),
    completed_date = coalesce(completed_date, audit_date),
    status         = 'completed'
where audit_date is not null and completed_date is null;

-- scheduled_date carries the workflow from here on; audit_date stays as 0005
-- wrote it so nothing that reads it breaks.
update public.compliance_audits set scheduled_date = audit_date where scheduled_date is null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'compliance_audits_org_ref_key') then
    -- Backfill refs before the unique constraint can go on. The numbering has
    -- to come from a subquery: a window function cannot sit in an UPDATE's
    -- SET list. Numbered per org, so AUD-2026-0001 means the same thing here
    -- as a work order's WO-2026-0001 does.
    update public.compliance_audits a
    set ref = r.new_ref
    from (
      select id,
             'AUD-' || to_char(coalesce(audit_date, created_at::date), 'YYYY') || '-'
             || lpad(row_number() over (partition by org_id order by created_at, id)::text, 4, '0') as new_ref
      from public.compliance_audits
      where ref is null
    ) r
    where a.id = r.id and a.ref is null;
    alter table public.compliance_audits add constraint compliance_audits_org_ref_key unique (org_id, ref);
  end if;
end $$;

create index if not exists audits_org_status_idx on public.compliance_audits (org_id, status) where deleted_at is null;
create index if not exists audits_date_idx       on public.compliance_audits (org_id, scheduled_date) where deleted_at is null;

-- A finding is a non-conformity against a clause. Like an inspection finding
-- it can become a defect — and from there a work order — so the trail runs
-- from "the regulator wrote this down" to "we fixed it".
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
-- Every money column in this schema is integer minor units, and every one is
-- in the org's base currency — that does not change. The secondary currency is
-- presentation only: a stated rate, with the date it was stated, shown beside
-- the real figure.
--
-- Deliberately not a live FX feed. An on-prem instance may have no outbound
-- internet at all, and a converted figure whose rate nobody can point at is
-- worse than no converted figure.
-- ----------------------------------------------------------------------------
alter table public.organizations add column if not exists base_currency text not null default 'NGN';
alter table public.organizations add column if not exists secondary_currency text;
-- Units of secondary per 1 base. 6dp carries an NGN->USD rate without
-- rounding the meaning out of it.
alter table public.organizations add column if not exists fx_rate numeric(18,6);
alter table public.organizations add column if not exists fx_rate_at date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_base_currency_check') then
    alter table public.organizations add constraint organizations_base_currency_check
      check (char_length(base_currency) = 3);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_secondary_currency_check') then
    alter table public.organizations add constraint organizations_secondary_currency_check
      check (secondary_currency is null or char_length(secondary_currency) = 3);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_fx_rate_check') then
    alter table public.organizations add constraint organizations_fx_rate_check
      check (fx_rate is null or fx_rate > 0);
  end if;
end $$;

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
alter table public.compliance_audit_findings enable row level security;

create policy risk_assessments_all on public.risk_assessments for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());
create policy audit_findings_all on public.compliance_audit_findings for all
  using (org_id = current_org_id()) with check (org_id = current_org_id());

grant select, insert, update, delete on public.risk_assessments          to assetcore_app;
grant select, insert, update, delete on public.compliance_audit_findings to assetcore_app;

grant execute on function public.risk_band(int) to assetcore_app;
