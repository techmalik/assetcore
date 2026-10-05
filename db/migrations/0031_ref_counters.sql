-- ============================================================================
-- 0031_ref_counters
--
-- Defect, risk and audit references (DEF-/RSK-/AUD-{year}-{0001}) were made
-- by counting this year's rows and adding one. Two creates at the same moment
-- counted the same number and the second hit the unique (org_id, ref)
-- constraint: a 500. Audit refs were worse: the count ran under site-scoped
-- RLS, so a site-scoped user saw fewer audits than exist and produced a
-- number already taken, every time, once another site had audits that year.
--
-- Same cure 0011 gave work orders: a counter row per org, prefix and year,
-- advanced by an upsert under that row's lock. next_ref() is security
-- definer so RLS cannot shrink what it sees, and the year comes from the
-- database's clock (the instance timezone) instead of the API's.
-- ============================================================================

create table if not exists public.ref_counters (
  org_id   uuid not null references public.organizations(id) on delete cascade,
  prefix   text not null,
  year     int  not null,
  next_seq int  not null default 1,
  primary key (org_id, prefix, year)
);

-- Reached only through next_ref(); no policy grants direct access.
alter table public.ref_counters enable row level security;

create or replace function public.next_ref(p_org_id uuid, p_prefix text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from current_date)::int;
  v_seq  int;
begin
  if p_prefix not in ('DEF', 'RSK', 'AUD') then
    raise exception 'unknown reference prefix %', p_prefix;
  end if;
  -- Called from a tenant request, it may only number its own org.
  if current_org_id() is not null and p_org_id is distinct from current_org_id() then
    raise exception 'reference requested for another organisation';
  end if;

  insert into public.ref_counters (org_id, prefix, year, next_seq)
  values (p_org_id, p_prefix, v_year, 2)
  on conflict (org_id, prefix, year) do update set next_seq = ref_counters.next_seq + 1
  returning next_seq - 1 into v_seq;
  return p_prefix || '-' || v_year || '-' || lpad(v_seq::text, 4, '0');
end;
$$;

revoke all on function public.next_ref(uuid, text) from public;
grant execute on function public.next_ref(uuid, text) to assetcore_app;

-- Backfill: start every org, prefix and year past the highest reference
-- already issued, so the first call after this migration cannot repeat one.
insert into public.ref_counters (org_id, prefix, year, next_seq)
select org_id, prefix, year, max(seq) + 1
from (
  select org_id, 'DEF' as prefix, split_part(ref, '-', 2)::int as year, split_part(ref, '-', 3)::int as seq
    from public.defects where ref ~ '^DEF-[0-9]{4}-[0-9]+$'
  union all
  select org_id, 'RSK', split_part(ref, '-', 2)::int, split_part(ref, '-', 3)::int
    from public.risk_assessments where ref ~ '^RSK-[0-9]{4}-[0-9]+$'
  union all
  select org_id, 'AUD', split_part(ref, '-', 2)::int, split_part(ref, '-', 3)::int
    from public.compliance_audits where ref ~ '^AUD-[0-9]{4}-[0-9]+$'
) issued
group by org_id, prefix, year
on conflict (org_id, prefix, year) do update set next_seq = greatest(ref_counters.next_seq, excluded.next_seq);
