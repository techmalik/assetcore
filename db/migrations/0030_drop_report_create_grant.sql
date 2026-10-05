-- report:create gated POST /reports, which was removed with the Reports API
-- (cleanup audit, Q3). It is no longer a capability, so it can no longer be
-- granted, and the access form refuses a grant list that still carries it:
-- clear it from any member who holds it as a per-user grant.
update public.memberships
   set extra_caps = array_remove(extra_caps, 'report:create')
 where 'report:create' = any(extra_caps);
