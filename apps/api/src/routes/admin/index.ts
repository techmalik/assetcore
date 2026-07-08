import { Router } from 'express'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requirePlatformAdmin } from '../../middleware/requirePlatformAdmin.js'
import { meRouter } from './me.js'
import { metricsRouter } from './metrics.js'
import { orgsRouter } from './orgs.js'
import { adminUsersRouter } from './users.js'
import { billingRouter } from './billing.js'
import { supportRouter } from './support.js'
import { platformAuditRouter } from './audit.js'
import { platformAdminsRouter } from './admins.js'

export const adminRouter = Router()

// /me is its own gate (requireAuth only — see me.ts for why); everything
// else requires an active platform_admins row.
adminRouter.use(meRouter)
adminRouter.use(requireAuth, requirePlatformAdmin())
adminRouter.use(metricsRouter)
adminRouter.use(orgsRouter)
adminRouter.use(adminUsersRouter)
adminRouter.use(billingRouter)
adminRouter.use(supportRouter)
adminRouter.use(platformAuditRouter)
adminRouter.use(platformAdminsRouter)
