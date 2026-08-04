-- ============================================================================
-- 0020_ngml_evaluation_accounts_owner
-- Promotes the two NGML evaluation accounts from 0019 (Paul O., Hayatu S.)
-- from ops_manager to owner, so their walkthrough covers everything the
-- product exposes — org settings, user management, licence/billing — and not
-- just the operational surface.
--
-- Scoped to those two emails by name rather than to the role, so it cannot
-- sweep up a real ops_manager on the instance.
--
-- Note: this is the tenant-app owner role only. It does not grant
-- public.platform_admins, which is AssetCore's own cross-instance console
-- (apps/admin) and is deliberately not something a client account gets.
-- ============================================================================

update public.memberships m
set    role_key = 'owner'
from   public.users u
where  u.id = m.user_id
  and  u.email in ('paul.o@ngml.com', 'hayatu.s@ngml.com')
  and  m.role_key <> 'owner';
