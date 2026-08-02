-- ============================================================================
-- 0015_asset_depreciation
-- Owner review: `assets.nbv_cents` (0001:175) has been read by the asset
-- detail panel and the asset-register report since day one, and has been
-- writable through the asset API, but NOTHING ever computed it — the only
-- writer in the whole repo is scripts/seed-dev.mjs, which inserts literals.
-- Every net-book-value figure the product has ever shown a user was fiction.
--
-- This migration makes depreciation real:
--
-- 1. `purchase_date` and `install_date` are promoted out of the `specs` jsonb
--    catch-all into real date columns. They have lived as untyped, unvalidated
--    free-text keys (written by the asset form and, worse, by the CSV import
--    with no format check at all), which is fine for display and useless as
--    the basis for arithmetic. Existing values are backfilled with a regex
--    guard so one malformed row cannot abort the migration; the old specs keys
--    are left in place for anything that already exported them, but nothing
--    reads them any more.
--
-- 2. Per-asset policy overrides (method / useful life / salvage / declining
--    rate). Every one is nullable, and null means "inherit the organisation
--    default" — the same resolution shape apply_asset_health() already uses for
--    settings->'health'->>'inspectionThreshold' (0013:38).
--
-- 3. The org-wide policy itself lives in organizations.settings->'depreciation'
--    ({method, usefulLifeYears, salvageRatePct, decliningRatePct, startFrom}),
--    editable by an org:manage holder in Admin -> Configuration.
--
-- 4. recompute_asset_depreciation_for(asset) / recompute_asset_depreciation(org),
--    split exactly like apply_asset_health / recompute_asset_health (0007) so
--    the API can recompute one asset on write without waiting for the 02:00
--    cron, and PATCH /org/settings can recompute a whole org the moment the
--    policy changes.
--
-- Correctness rule worth stating out loud: an asset with no purchase value, or
-- no usable start date, gets nbv_cents = NULL, never 0. Null renders as "—";
-- zero renders as a fully written-down asset, which is a different and much
-- more confident claim than we are entitled to make.
-- ============================================================================

alter table public.assets
  add column if not exists purchase_date          date,
  add column if not exists install_date           date,
  add column if not exists depreciation_method    text,
  add column if not exists useful_life_years      numeric(5,2),
  add column if not exists salvage_value_cents    bigint,
  add column if not exists declining_rate_pct     numeric(5,2),
  add column if not exists accumulated_depreciation_cents bigint,
  add column if not exists nbv_computed_at        date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'assets_depreciation_method_check') then
    alter table public.assets add constraint assets_depreciation_method_check
      check (depreciation_method is null
             or depreciation_method in ('none', 'straight_line', 'declining_balance'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assets_useful_life_years_check') then
    alter table public.assets add constraint assets_useful_life_years_check
      check (useful_life_years is null or useful_life_years > 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assets_salvage_value_check') then
    alter table public.assets add constraint assets_salvage_value_check
      check (salvage_value_cents is null or salvage_value_cents >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assets_declining_rate_check') then
    alter table public.assets add constraint assets_declining_rate_check
      check (declining_rate_pct is null or (declining_rate_pct > 0 and declining_rate_pct < 100));
  end if;
end $$;

-- Backfill from specs. The regex guard matters: these keys were never
-- validated on the way in, so a hand-edited CSV could hold anything.
update public.assets
set purchase_date = (specs->>'purchase_date')::date
where purchase_date is null
  and specs->>'purchase_date' ~ '^\d{4}-\d{2}-\d{2}$';

update public.assets
set install_date = (specs->>'install_date')::date
where install_date is null
  and specs->>'install_date' ~ '^\d{4}-\d{2}-\d{2}$';

-- ----------------------------------------------------------------------------
-- recompute_asset_depreciation_for — one asset. Resolves the effective policy
-- (per-asset override -> org setting -> hard default), then writes nbv_cents,
-- accumulated_depreciation_cents and nbv_computed_at.
-- ----------------------------------------------------------------------------
create or replace function public.recompute_asset_depreciation_for(p_asset_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset       record;
  v_method      text;
  v_life        numeric;
  v_rate        numeric;
  v_start_from  text;
  v_start       date;
  v_purchase    bigint;
  v_salvage     bigint;
  v_depreciable bigint;
  v_months      int;
  v_nbv         bigint;
  v_accum       bigint;
begin
  select a.id, a.purchase_value_cents, a.purchase_date, a.install_date,
         a.depreciation_method, a.useful_life_years, a.salvage_value_cents,
         a.declining_rate_pct,
         coalesce(a.depreciation_method,
                  nullif(o.settings->'depreciation'->>'method', ''),
                  'straight_line')                                      as eff_method,
         coalesce(a.useful_life_years,
                  nullif(o.settings->'depreciation'->>'usefulLifeYears', '')::numeric,
                  10)                                                   as eff_life,
         coalesce(a.declining_rate_pct,
                  nullif(o.settings->'depreciation'->>'decliningRatePct', '')::numeric,
                  20)                                                   as eff_rate,
         coalesce(nullif(o.settings->'depreciation'->>'salvageRatePct', '')::numeric, 0) as eff_salvage_pct,
         coalesce(nullif(o.settings->'depreciation'->>'startFrom', ''), 'install_date')  as eff_start_from
  into v_asset
  from public.assets a
  join public.organizations o on o.id = a.org_id
  where a.id = p_asset_id and a.deleted_at is null
  for update of a;

  if not found then
    return;
  end if;

  v_method     := v_asset.eff_method;
  v_life       := v_asset.eff_life;
  v_rate       := v_asset.eff_rate;
  v_start_from := v_asset.eff_start_from;
  v_purchase   := v_asset.purchase_value_cents;

  -- Either basis falls back to the other, so a half-filled asset still
  -- produces a figure rather than silently showing nothing.
  v_start := case v_start_from
    when 'purchase_date' then coalesce(v_asset.purchase_date, v_asset.install_date)
    else coalesce(v_asset.install_date, v_asset.purchase_date)
  end;

  -- Unknown, not zero. See the banner.
  if v_method = 'none' or v_purchase is null or v_start is null then
    update public.assets
    set nbv_cents = null, accumulated_depreciation_cents = null, nbv_computed_at = current_date
    where id = p_asset_id;
    return;
  end if;

  v_salvage := coalesce(
    v_asset.salvage_value_cents,
    round(v_purchase * v_asset.eff_salvage_pct / 100.0)::bigint
  );
  -- A salvage value above the purchase price is nonsense; treat it as "no
  -- depreciation" rather than producing a negative depreciable base.
  v_salvage := greatest(0, least(v_salvage, v_purchase));

  v_months := greatest(0, (
    extract(year  from age(current_date, v_start))::int * 12 +
    extract(month from age(current_date, v_start))::int
  ));

  if v_method = 'declining_balance' then
    v_nbv   := round(v_purchase * power(1 - v_rate / 100.0, v_months / 12.0))::bigint;
    v_nbv   := greatest(v_nbv, v_salvage);
    v_accum := v_purchase - v_nbv;
  else
    -- straight_line
    v_depreciable := v_purchase - v_salvage;
    v_accum := round(v_depreciable * least(1.0, v_months::numeric / (v_life * 12)))::bigint;
    v_nbv   := v_purchase - v_accum;
  end if;

  -- A fully depreciated asset sits at its salvage value, never below it.
  v_nbv   := greatest(v_nbv, v_salvage, 0);
  v_accum := least(greatest(v_accum, 0), v_purchase - v_salvage);

  update public.assets
  set nbv_cents = v_nbv,
      accumulated_depreciation_cents = v_accum,
      nbv_computed_at = current_date
  where id = p_asset_id;
end;
$$;

grant execute on function public.recompute_asset_depreciation_for(uuid) to assetcore_app;

-- ----------------------------------------------------------------------------
-- recompute_asset_depreciation — whole org (or every org, for the cron).
-- Mirrors recompute_asset_health's loop-and-delegate shape (0007:137).
-- ----------------------------------------------------------------------------
create or replace function public.recompute_asset_depreciation(p_org_id uuid default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_count int := 0;
begin
  for v_id in
    select a.id from public.assets a
    where a.deleted_at is null
      and (p_org_id is null or a.org_id = p_org_id)
  loop
    perform public.recompute_asset_depreciation_for(v_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

grant execute on function public.recompute_asset_depreciation(uuid) to assetcore_app;

comment on column public.assets.nbv_cents is
  'Net book value. DERIVED — written only by recompute_asset_depreciation_for(); not client-writable.';
comment on column public.assets.accumulated_depreciation_cents is
  'DERIVED — written only by recompute_asset_depreciation_for(); not client-writable.';

-- Populate existing rows once so nothing shows a stale seeded literal.
select public.recompute_asset_depreciation();
