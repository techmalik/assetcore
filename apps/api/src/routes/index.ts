import { Router } from 'express'
import { authRouter } from '../auth/routes.js'
import { systemRouter } from './system.js'
import { sitesRouter } from './sites.js'
import { locationsRouter } from './locations.js'
import { categoriesRouter } from './categories.js'
import { assetsRouter } from './assets/index.js'
import { workOrdersRouter } from './workOrders/index.js'
import { pmSchedulesRouter } from './pmSchedules.js'
import { pmTasksRouter } from './pmTasks.js'
import { maintenanceEventsRouter } from './maintenanceEvents.js'
import { complianceRouter } from './compliance/index.js'
import { inspectionsRouter } from './inspections.js'
import { devicesRouter } from './devices.js'
import { integrationsRouter } from './integrations.js'
import { notificationsRouter } from './notifications.js'
import { exportsRouter } from './exports.js'
import { auditRouter } from './audit.js'
import { dashboardRouter } from './dashboard.js'
import { orgRouter } from './org.js'
import { orgMembersRouter } from './orgMembers.js'
import { profileRouter } from './profile.js'
import { licenceRouter } from './licence.js'
import { adminRouter } from './admin/index.js'
import { sparePartsRouter } from './spareParts.js'
import { depreciationRouter } from './depreciation.js'
import { defectsRouter } from './defects.js'
import { risksRouter } from './risks.js'
import { approvalsRouter } from './approvals/index.js'
import { escalationsRouter } from './escalations.js'
import { analyticsRouter } from './analytics.js'
import { integrityRouter } from './integrity.js'

import { filesRouter } from '../files.js'
import { requireAuth } from '../middleware/requireAuth.js'
import { requireOrg } from '../middleware/requireOrg.js'
import { requireActiveMembership } from '../middleware/requireActiveMembership.js'

export const apiRouter = Router()

// Public first: sign-in, the platform console (which runs its own platform
// admin gate) and the liveness probe.

apiRouter.use('/auth', authRouter)
apiRouter.use('/admin', adminRouter)
apiRouter.use(systemRouter)

// Every route below is a tenant route: signed in, attached to an org, and an
// active member. Checked once here, per request. The routers used to carry
// this line each, and since they are mounted without a path prefix every
// router a request passed re-ran it, membership query included (about 28
// times for a write to the last router). Routers add only requireCap.
apiRouter.use(requireAuth, requireOrg, requireActiveMembership)

apiRouter.use(sitesRouter)
apiRouter.use(locationsRouter)
apiRouter.use(categoriesRouter)
apiRouter.use(assetsRouter)
apiRouter.use(workOrdersRouter)
apiRouter.use(pmSchedulesRouter)
apiRouter.use(pmTasksRouter)
apiRouter.use(maintenanceEventsRouter)
apiRouter.use(complianceRouter)
apiRouter.use(inspectionsRouter)
apiRouter.use(devicesRouter)
apiRouter.use(integrationsRouter)
apiRouter.use(notificationsRouter)
apiRouter.use(exportsRouter)
apiRouter.use(auditRouter)
apiRouter.use(dashboardRouter)
apiRouter.use(orgRouter)
apiRouter.use(orgMembersRouter)
apiRouter.use(profileRouter)
apiRouter.use(licenceRouter)
apiRouter.use(sparePartsRouter)
apiRouter.use(depreciationRouter)
apiRouter.use(defectsRouter)
apiRouter.use(risksRouter)
apiRouter.use(approvalsRouter)
apiRouter.use(escalationsRouter)
apiRouter.use(analyticsRouter)
apiRouter.use(integrityRouter)
apiRouter.use(filesRouter)

// A signed-in member asking for a path that does not exist.
apiRouter.use((_req, res) => {
  res.status(404).json({ error: 'not_found' })
})
