# Security design

## Authentication

We own auth — no third-party identity provider by default (SSO is backlog,
see below). Passwords are hashed with argon2id. Sessions are a short-lived
(~60 min) JWT access token (`sub`, `email`, `org_id`, `role_key` claims) sent
as a bearer token, plus an httpOnly, same-site refresh cookie with rotation
(`auth_tokens` table, `kind='refresh'`) — a stolen access token expires
quickly; a stolen refresh cookie is revocable server-side and rotates on use.
Password reset and invite flows use single-use, expiring, hashed tokens in
the same table (`kind='reset'|'invite'`) — never emailed in plaintext,
never guessable.

## Authorization

Two layers, by design, not for show:

1. **Application-level RBAC** (`apps/api/src/middleware/rbac.ts`, mirrored in
   `apps/app/src/lib/rbac.js` for UI gating only): each mutating route calls
   `requireCap('entity:action')`, checked against the caller's `role_key`.
2. **Row-level security in Postgres**, as defense-in-depth against a bug in
   layer 1: the API connects as `assetcore_app`, a non-owner, non-superuser
   role. Every request runs inside a transaction with
   `SET LOCAL app.org_id / app.user_id / app.role_key` (see
   `apps/api/src/db.ts`'s `withOrgContext`), which RLS policies read via
   `current_org_id()` etc. — even a route that forgot its `requireCap` check
   still can't read or write another org's rows, because Postgres itself
   won't return them.

A disabled member (`memberships.status='disabled'` or `users.status='disabled'`)
is locked out of every mutating route within one request via
`requireActiveMembership` — not just at their next token refresh.

## Backoffice access

`/admin/` (the platform console AssetCore staff use to support this
instance) is deployed same-origin as the tenant app for simplicity, but it is
**not** meant to be reachable from the open internet. Restrict it at the
network layer — VPN, IP allowlist, or a separate internal-only listener —
using whatever the client's existing network perimeter provides. Nginx alone
does not enforce this; see `deploy/nginx/nginx.conf`'s `/admin/` location
block for where to add an `allow`/`deny` list or `auth_request` if the client
has no VPN.

## Secrets

- `JWT_SECRET`, `POSTGRES_PASSWORD`, and the rotated `assetcore_app` DB
  password live only in `deploy/.env.deploy` (gitignored, never committed)
  and as container environment variables — never in the image, never in
  version control.
- Integration credentials (SAP RFC password, Termii API key, etc.), when a
  client engagement wires them up, are stored in `public.integrations.config`
  (jsonb) and never re-displayed to the UI after entry — see `Integrations.jsx`.
- `deploy/instance.config.json` (org name, owner/staff emails) is real
  per-client data — gitignored; only `.example` is committed.

## Backlog (see root `README.md` for the full list)

SSO (Azure AD) and MFA are not implemented — the `signInWithSSO` boundary in
`apps/app/src/lib/auth.js` is reserved for it but currently a no-op. Until
then, argon2id + strong generated temp passwords + forced first-login change
is the whole story. Treat SSO/MFA as an engagement item if a client's
compliance posture requires it.
