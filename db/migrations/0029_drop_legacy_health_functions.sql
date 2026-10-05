-- Retire SQL functions nothing calls any more.
--
-- recompute_asset_health(uuid) and recompute_asset_health_for(uuid, uuid) were
-- the linear-decay health pass. The nightly job now scores health in the API's
-- TypeScript engine (healthService.ts, recomputeAllHealthScores), and
-- their last callers were the dev seed and one test, both moved to the engine.
-- apply_asset_health() stays: the engine writes every score through it so the
-- 50% and 30% crossings fire.
--
-- licence_status(date) (0001) was never called by the API, a policy, a view or
-- another function.

drop function if exists public.recompute_asset_health(uuid);
drop function if exists public.recompute_asset_health_for(uuid, uuid);
drop function if exists public.licence_status(date);
