-- ============================================================================
-- 0019_ngml_evaluation_accounts
-- Two evaluation logins for NGML personnel (Paul O., Hayatu S.) who want to
-- look around the platform. Accounts are data, not schema — they live here so
-- they land on the instance through the same migrate.mjs run every deploy
-- already performs, rather than needing a hand-run insert on the VPS.
--
-- Role: ops_manager. Enough to exercise assets, work orders, PM tasks,
-- inspections and reports end to end, without org settings / user management /
-- billing (owner) and without being penned into read-only (viewer).
--
-- Membership targets whatever the instance's live org is (single-tenant per
-- deployment), not a hardcoded id, so this is correct on the client's box as
-- well as on a dev database seeded by seed-dev.mjs.
--
-- Password hashes are argon2id, generated the same way apps/api hashes them
-- (argon2.hash(pw, { type: argon2id })). The shared evaluation password is
-- NgmlDemo2026 — rotate or disable these two accounts once the evaluation is
-- over (update public.users set status = 'disabled' where email in (...)).
--
-- Idempotent: on conflict do nothing on both the user and the membership, so
-- re-running never clobbers a password either of them has since changed.
-- ============================================================================

insert into public.users (email, password_hash, full_name, status, must_change_password)
values
  ('paul.o@ngml.com',
   '$argon2id$v=19$m=65536,p=4,t=3$N/+94OuH2UdpjHHHRsT2JA$krh9IXOOZG6Uk58FOkWLIFziQqIKJyZ6FFZPSj6xbs8',
   'Paul O.', 'active', false),
  ('hayatu.s@ngml.com',
   '$argon2id$v=19$m=65536,p=4,t=3$Px6aTb22tD5Bpvgaa1CUog$Ee0DXEv6dYkJTB4CxrVyE7ZGmlc+Cadz7cc8BpHuSkI',
   'Hayatu S.', 'active', false)
on conflict (email) do nothing;

insert into public.memberships (org_id, user_id, role_key, status)
select o.id, u.id, 'ops_manager', 'active'
from   public.users u
cross join lateral (
  select id from public.organizations where deleted_at is null order by created_at asc limit 1
) o
where  u.email in ('paul.o@ngml.com', 'hayatu.s@ngml.com')
on conflict (org_id, user_id) do nothing;
