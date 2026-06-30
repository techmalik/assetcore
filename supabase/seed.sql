-- ============================================================================
-- AssetCore — demo seed (NGML)
-- Creates a demo organization with an owner login, sites, asset categories,
-- and a handful of sample assets so the app has data on first run.
--
-- DEMO LOGIN →  email: a.okeke@ngml.example   password: Password123!
--
-- Safe to run in the Supabase SQL editor (cloud) or via `supabase db reset`
-- (local). All inserts are idempotent (on conflict do nothing). If your
-- Supabase version's auth schema differs and the auth.users / auth.identities
-- block errors, skip it and simply register a new org through the app UI.
-- ============================================================================

-- Fixed IDs so re-running is stable.
-- org  = 11111111-…   owner = 22222222-…
do $$
declare
  v_org  uuid := '11111111-1111-1111-1111-111111111111';
  v_user uuid := '22222222-2222-2222-2222-222222222222';
begin
  -- --- demo owner auth user (email/password) ---------------------------------
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    -- GoTrue expects empty strings (not NULL) for these token columns
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_user, 'authenticated', 'authenticated',
    'a.okeke@ngml.example', crypt('Password123!', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Adaeze Okeke"}'::jsonb,
    '', '', '', ''
  ) on conflict (id) do nothing;

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_user,
    jsonb_build_object('sub', v_user::text, 'email', 'a.okeke@ngml.example'),
    'email', v_user::text, now(), now(), now()
  ) on conflict do nothing;

  -- --- profile (trigger doesn't fire for direct auth.users inserts) -----------
  insert into public.profiles (id, full_name, email)
  values (v_user, 'Adaeze Okeke', 'a.okeke@ngml.example')
  on conflict (id) do nothing;

  -- --- organization + owner membership ---------------------------------------
  insert into public.organizations (id, name, short_name, industry, region, plan, billing_status)
  values (v_org, 'Nigeria Gas Marketing Limited', 'NGML', 'Oil & Gas Distribution', 'Nigeria', 'growth', 'invoice')
  on conflict (id) do nothing;

  insert into public.memberships (org_id, user_id, role_key, status)
  values (v_org, v_user, 'owner', 'active')
  on conflict (org_id, user_id) do nothing;

  -- --- sites -----------------------------------------------------------------
  insert into public.sites (id, org_id, name, code, region, lat, lng) values
    ('a0000000-0000-0000-0000-000000000001', v_org, 'Lagos DS-04',       'LAG-DS04', 'Lagos',  6.45, 3.40),
    ('a0000000-0000-0000-0000-000000000002', v_org, 'Delta CS',          'DEL-CS',   'Delta',  5.55, 5.79),
    ('a0000000-0000-0000-0000-000000000003', v_org, 'North Benin',       'NTH-BEN',  'Edo',    6.34, 5.62),
    ('a0000000-0000-0000-0000-000000000004', v_org, 'Warri Terminal A',  'WAR-TA',   'Delta',  5.52, 5.75),
    ('a0000000-0000-0000-0000-000000000005', v_org, 'Aba Network',       'ABA-NET',  'Abia',   5.11, 7.37)
  on conflict (id) do nothing;

  -- --- asset categories ------------------------------------------------------
  insert into public.asset_categories (id, org_id, name, code) values
    ('c0000000-0000-0000-0000-000000000001', v_org, 'Metering Station',   'MTR'),
    ('c0000000-0000-0000-0000-000000000002', v_org, 'Compressor',         'CMP'),
    ('c0000000-0000-0000-0000-000000000003', v_org, 'Pressure Regulator', 'REG'),
    ('c0000000-0000-0000-0000-000000000004', v_org, 'Valve',              'VLV'),
    ('c0000000-0000-0000-0000-000000000005', v_org, 'Pipeline',           'PIP'),
    ('c0000000-0000-0000-0000-000000000006', v_org, 'SCADA / RTU',        'SCR'),
    ('c0000000-0000-0000-0000-000000000007', v_org, 'ESD Valve',          'ESD')
  on conflict (id) do nothing;

  -- --- sample assets ---------------------------------------------------------
  insert into public.assets (org_id, site_id, ain, name, category_id, status, health_score, nbv_cents) values
    (v_org, 'a0000000-0000-0000-0000-000000000001', 'NGML-MTR-0042', 'Lagos DS-04 Metering Station',     'c0000000-0000-0000-0000-000000000001', 'critical',    32, 19540000000),
    (v_org, 'a0000000-0000-0000-0000-000000000002', 'NGML-CMP-0017', 'Delta Compression Station C-017',  'c0000000-0000-0000-0000-000000000002', 'attention',   61, 84020000000),
    (v_org, 'a0000000-0000-0000-0000-000000000003', 'NGML-REG-0089', 'North Benin PRG-089',              'c0000000-0000-0000-0000-000000000003', 'attention',   74, 2410000000),
    (v_org, 'a0000000-0000-0000-0000-000000000004', 'NGML-VLV-0089', 'Warri T-A Isolation Valve 089',    'c0000000-0000-0000-0000-000000000004', 'operational', 88, 870000000),
    (v_org, 'a0000000-0000-0000-0000-000000000005', 'NGML-PIP-0312', 'Aba DN200 Pipeline Segment 312',   'c0000000-0000-0000-0000-000000000005', 'operational', 92, 120000000000),
    (v_org, 'a0000000-0000-0000-0000-000000000004', 'NGML-SCR-041',  'Warri Terminal A RTU',             'c0000000-0000-0000-0000-000000000006', 'critical',    18, 1230000000)
  on conflict (org_id, ain) do nothing;

  -- --- sample work orders ---------------------------------------------------
  insert into public.work_orders (id, org_id, site_id, asset_id, ref, title, description, type, status, priority, created_by, sla_due) values
    ('b1000000-0000-0000-0000-000000000001', v_org,
      'a0000000-0000-0000-0000-000000000001',
      (select id from public.assets where ain='NGML-MTR-0042' and org_id=v_org),
      'WO-2025-0041', 'Pressure sensor calibration — MTR-0042',
      'Inlet pressure reading deviating by >5%. Sensor requires recalibration or replacement.',
      'corrective', 'in_progress', 'critical', v_user,
      now() + interval '2 days'),
    ('b1000000-0000-0000-0000-000000000002', v_org,
      'a0000000-0000-0000-0000-000000000004',
      (select id from public.assets where ain='NGML-SCR-041' and org_id=v_org),
      'WO-2025-0042', 'SCADA RTU comms failure — Warri A',
      'RTU lost communication with SCADA host. No telemetry for 47 minutes. Field inspection required.',
      'emergency', 'assigned', 'critical', v_user,
      now() + interval '1 day'),
    ('b1000000-0000-0000-0000-000000000003', v_org,
      'a0000000-0000-0000-0000-000000000002',
      (select id from public.assets where ain='NGML-CMP-0017' and org_id=v_org),
      'WO-2025-0039', 'Quarterly service — CMP-0017',
      'Scheduled quarterly preventive maintenance. Lubrication, filter change, belt inspection.',
      'preventive', 'new', 'medium', v_user,
      now() + interval '7 days'),
    ('b1000000-0000-0000-0000-000000000004', v_org,
      'a0000000-0000-0000-0000-000000000003',
      (select id from public.assets where ain='NGML-REG-0089' and org_id=v_org),
      'WO-2025-0038', 'PRG-089 outlet pressure variance',
      'Outlet pressure 0.8 bar above set point. Possible seat wear. Inspect and adjust.',
      'corrective', 'awaiting_parts', 'high', v_user,
      now() + interval '3 days'),
    ('b1000000-0000-0000-0000-000000000005', v_org,
      'a0000000-0000-0000-0000-000000000001',
      (select id from public.assets where ain='NGML-MTR-0042' and org_id=v_org),
      'WO-2025-0035', 'Annual NMDPRA inspection — MTR-0042',
      'Regulatory inspection per NMDPRA directive. Prepare calibration certificates and maintenance logs.',
      'inspection', 'inspection', 'high', v_user,
      now() + interval '5 days')
  on conflict (id) do nothing;

  -- --- compliance licences (Phase 3) -----------------------------------------
  insert into public.compliance_licences (id, org_id, site_id, name, licence_number, issued_date, expiry_date, authority_id, notes) values
    ('d1000000-0000-0000-0000-000000000001', v_org,
      'a0000000-0000-0000-0000-000000000001',
      'Operating Licence — Lagos DS-04', 'NMDPRA/OL/2024/LAG-DS04',
      '2024-01-15', '2026-01-14',
      (select id from public.regulatory_authorities where code='NMDPRA'), null),
    ('d1000000-0000-0000-0000-000000000002', v_org,
      'a0000000-0000-0000-0000-000000000002',
      'Environmental Permit — Delta CS', 'NESREA/EP/2023/DEL-CS',
      '2023-03-01', '2026-02-28',
      (select id from public.regulatory_authorities where code='NESREA'), null),
    ('d1000000-0000-0000-0000-000000000003', v_org,
      'a0000000-0000-0000-0000-000000000002',
      'Pressure Vessel Certificate — CMP-0017', 'NSC/PVC/2024/CMP0017',
      '2024-10-10', current_date - interval '5 days',
      (select id from public.regulatory_authorities where code='NSC'), 'EXPIRED — renewal urgent'),
    ('d1000000-0000-0000-0000-000000000004', v_org,
      'a0000000-0000-0000-0000-000000000004',
      'Fire Safety Certificate — Warri Terminal A', 'NSCDC/FSC/2024/WAR-TA',
      '2024-08-05', current_date + interval '6 days',
      (select id from public.regulatory_authorities where code='NSCDC'), null),
    ('d1000000-0000-0000-0000-000000000005', v_org,
      'a0000000-0000-0000-0000-000000000001',
      'Metering Certification — MTR-0042', 'NMI/MC/2024/MTR0042',
      '2024-01-14', '2025-07-13',
      (select id from public.regulatory_authorities where code='NMI'), null),
    ('d1000000-0000-0000-0000-000000000006', v_org,
      'a0000000-0000-0000-0000-000000000005',
      'Pipeline Operating Certificate — PIP-0312', 'NMDPRA/POC/2023/PIP0312',
      '2023-02-02', '2026-02-01',
      (select id from public.regulatory_authorities where code='NMDPRA'), null),
    ('d1000000-0000-0000-0000-000000000007', v_org,
      'a0000000-0000-0000-0000-000000000001',
      'ESD System Certificate — Lagos', 'NSC/ESD/2024/LAG001',
      '2024-06-20', '2026-06-19',
      (select id from public.regulatory_authorities where code='NSC'), null)
  on conflict (id) do nothing;

  -- --- sample inspections (Phase 3) ------------------------------------------
  insert into public.inspections (id, org_id, asset_id, site_id, title, kind, status, inspector_id, scheduled_date) values
    ('e1000000-0000-0000-0000-000000000001', v_org,
      (select id from public.assets where ain='NGML-MTR-0042' and org_id=v_org),
      'a0000000-0000-0000-0000-000000000001',
      'Lagos DS-04 — Inlet Calibration Inspection', 'safety', 'due', v_user, current_date),
    ('e1000000-0000-0000-0000-000000000002', v_org,
      (select id from public.assets where ain='NGML-CMP-0017' and org_id=v_org),
      'a0000000-0000-0000-0000-000000000002',
      'CMP-0017 Condition Assessment', 'condition', 'scheduled', v_user, current_date + interval '1 day'),
    ('e1000000-0000-0000-0000-000000000003', v_org,
      (select id from public.assets where ain='NGML-PIP-0312' and org_id=v_org),
      'a0000000-0000-0000-0000-000000000005',
      'Aba DN200 Pipeline Integrity Check', 'integrity', 'completed', v_user, current_date - interval '4 days')
  on conflict (id) do nothing;

  -- mark completed inspection
  update public.inspections
  set status='completed', completed_date=current_date - interval '4 days',
      findings='No corrosion detected. Cathodic protection reading nominal at -0.85V. Coating intact.'
  where id='e1000000-0000-0000-0000-000000000003';

  -- ── Devices (Phase 4) ────────────────────────────────────────────────────────
  insert into public.devices (id, org_id, asset_id, site_id, serial_number, name, kind, protocol, status, firmware_version, ip_address)
  values
    -- Flow transmitter on NGML-MTR-0042, online
    ('f1000000-0000-0000-0000-000000000001',
     v_org,
     (select id from public.assets where org_id = v_org and ain = 'NGML-MTR-0042'),
     (select id from public.sites where org_id = v_org and code = 'LAG-DS04'),
     'TRM-FLW-001', 'Lagos DS-04 Flow Transmitter', 'meter', 'modbus', 'online',
     'v2.3.1', '192.168.10.21'),
    -- Pressure sensor on NGML-CMP-0017, unprovisioned
    ('f1000000-0000-0000-0000-000000000002',
     v_org,
     (select id from public.assets where org_id = v_org and ain = 'NGML-CMP-0017'),
     (select id from public.sites where org_id = v_org and code = 'DEL-CS'),
     'SEN-PRS-007', 'Delta CS Pressure Sensor', 'sensor', 'mqtt', 'unprovisioned',
     null, null),
    -- Gateway at Warri terminal (no specific asset link)
    ('f1000000-0000-0000-0000-000000000003',
     v_org,
     null,
     (select id from public.sites where org_id = v_org and code = 'WAR-TA'),
     'GW-WAR-001', 'Warri Terminal Gateway', 'gateway', 'mqtt', 'offline',
     'v1.8.0', '10.0.1.5')
  on conflict (id) do nothing;

  -- Set last_seen_at for online/offline devices
  update public.devices set last_seen_at = now() - interval '4 minutes'
  where id = 'f1000000-0000-0000-0000-000000000001';

  update public.devices set last_seen_at = now() - interval '3 days'
  where id = 'f1000000-0000-0000-0000-000000000003';

end $$;

-- ============================================================================
-- Platform backoffice — demo superadmin (local dev only).
-- Logs into apps/admin (admin.assetcore.com). Has NO membership, so it is not a
-- tenant. For a CLOUD project, instead run a one-off in the SQL editor:
--   insert into public.platform_admins (user_id, role, full_name, status)
--   values ('<your-auth-uid>', 'superadmin', 'Your Name', 'active');
--
-- DEMO ADMIN LOGIN →  email: admin@assetcore.io   password: Password123!
-- ============================================================================
do $$
declare
  v_admin uuid := '33333333-3333-3333-3333-333333333333';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_admin, 'authenticated', 'authenticated',
    'admin@assetcore.io', crypt('Password123!', gen_salt('bf')),
    now(), now(), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Malik Kabir"}'::jsonb,
    '', '', '', ''
  ) on conflict (id) do nothing;

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id,
    last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(), v_admin,
    jsonb_build_object('sub', v_admin::text, 'email', 'admin@assetcore.io'),
    'email', v_admin::text, now(), now(), now()
  ) on conflict do nothing;

  insert into public.profiles (id, full_name, email)
  values (v_admin, 'Malik Kabir', 'admin@assetcore.io')
  on conflict (id) do nothing;

  insert into public.platform_admins (user_id, role, full_name, status)
  values (v_admin, 'superadmin', 'Malik Kabir', 'active')
  on conflict (user_id) do nothing;
end $$;
