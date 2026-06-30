-- ============================================================================
-- Phase 4: IoT Device Registry · Telemetry (partitioned) · Integrations · SMS log
-- ============================================================================

-- ── Devices ──────────────────────────────────────────────────────────────────
create table if not exists public.devices (
  id               uuid default gen_random_uuid() primary key,
  org_id           uuid not null references public.organizations(id),
  asset_id         uuid references public.assets(id) on delete set null,
  site_id          uuid references public.sites(id) on delete set null,
  serial_number    text,
  name             text not null,
  kind             text not null default 'sensor',   -- sensor|gateway|meter|camera|plc
  protocol         text not null default 'mqtt',     -- mqtt|modbus|http|opc-ua
  status           text not null default 'unprovisioned', -- online|offline|error|unprovisioned
  last_seen_at     timestamptz,
  firmware_version text,
  ip_address       text,
  config           jsonb not null default '{}',
  created_at       timestamptz default now(),
  deleted_at       timestamptz
);

alter table public.devices enable row level security;
create policy sel on public.devices for select using (org_id = (auth.jwt()->>'org_id')::uuid);
create policy ins on public.devices for insert with check (org_id = (auth.jwt()->>'org_id')::uuid);
create policy upd on public.devices for update using (org_id = (auth.jwt()->>'org_id')::uuid);

create index on public.devices (org_id, status);
create index on public.devices (org_id, asset_id);

grant select, insert, update on public.devices to authenticated;

-- ── Telemetry readings (partitioned by month) ─────────────────────────────────
create table if not exists public.telemetry_readings (
  id           uuid    default gen_random_uuid(),
  org_id       uuid    not null,
  device_id    uuid    not null references public.devices(id) on delete cascade,
  reading_type text    not null,   -- pressure|temperature|flow_rate|vibration|level|...
  value        numeric not null,
  unit         text    not null,
  quality      int     not null default 100,   -- 0–100 data quality score
  recorded_at  timestamptz not null default now(),
  primary key (id, recorded_at)
) partition by range (recorded_at);

create table public.telemetry_readings_2026
  partition of public.telemetry_readings
  for values from ('2026-01-01') to ('2027-01-01');

create table public.telemetry_readings_2027
  partition of public.telemetry_readings
  for values from ('2027-01-01') to ('2028-01-01');

alter table public.telemetry_readings      enable row level security;
alter table public.telemetry_readings_2026 enable row level security;
alter table public.telemetry_readings_2027 enable row level security;

create policy sel on public.telemetry_readings for select using (org_id = (auth.jwt()->>'org_id')::uuid);
create policy ins on public.telemetry_readings for insert with check (org_id = (auth.jwt()->>'org_id')::uuid);

create index on public.telemetry_readings_2026 (org_id, device_id, recorded_at desc);
create index on public.telemetry_readings_2027 (org_id, device_id, recorded_at desc);

grant select, insert on public.telemetry_readings      to authenticated;
grant select, insert on public.telemetry_readings_2026 to authenticated;
grant select, insert on public.telemetry_readings_2027 to authenticated;

-- ── Integrations ──────────────────────────────────────────────────────────────
-- Stores non-secret config. Secrets live in Supabase Vault / Edge Function env.
create table if not exists public.integrations (
  id               uuid default gen_random_uuid() primary key,
  org_id           uuid not null references public.organizations(id),
  kind             text not null,   -- sap|termii|scada|azure_iot|...
  label            text,
  enabled          boolean not null default false,
  config           jsonb   not null default '{}',
  last_synced_at   timestamptz,
  last_sync_status text,            -- ok|error
  last_sync_error  text,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  unique (org_id, kind)
);

alter table public.integrations enable row level security;
create policy sel on public.integrations for select using (org_id = (auth.jwt()->>'org_id')::uuid);
create policy ins on public.integrations for insert with check (org_id = (auth.jwt()->>'org_id')::uuid);
create policy upd on public.integrations for update using (org_id = (auth.jwt()->>'org_id')::uuid);

grant select, insert, update on public.integrations to authenticated;

-- ── SMS log (outbound Termii messages) ───────────────────────────────────────
create table if not exists public.sms_log (
  id            uuid default gen_random_uuid() primary key,
  org_id        uuid not null references public.organizations(id),
  to_number     text not null,
  message       text not null,
  status        text not null default 'pending',  -- pending|sent|failed
  provider_ref  text,
  error_message text,
  sent_at       timestamptz,
  created_at    timestamptz default now()
);

alter table public.sms_log enable row level security;
create policy sel on public.sms_log for select using (org_id = (auth.jwt()->>'org_id')::uuid);

grant select on public.sms_log to authenticated;
