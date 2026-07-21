import { Router } from 'express'
import { authRouter } from '../auth/routes.js'
import { healthRouter } from './health.js'
import { sitesRouter } from './sites.js'
import { locationsRouter } from './locations.js'
import { categoriesRouter } from './categories.js'
import { assetsRouter } from './assets.js'
import { workOrdersRouter } from './workOrders.js'
import { pmSchedulesRouter } from './pmSchedules.js'
import { pmTasksRouter } from './pmTasks.js'
import { complianceRouter } from './compliance.js'
import { inspectionsRouter } from './inspections.js'
import { devicesRouter } from './devices.js'
import { integrationsRouter } from './integrations.js'
import { notificationsRouter } from './notifications.js'
import { reportsRouter } from './reports.js'
import { auditRouter } from './audit.js'
import { dashboardRouter } from './dashboard.js'
import { orgRouter } from './org.js'
import { orgMembersRouter } from './orgMembers.js'
import { profileRouter } from './profile.js'
import { licenceRouter } from './licence.js'
import { adminRouter } from './admin/index.js'

export const apiRouter = Router()

apiRouter.use('/auth', authRouter)
apiRouter.use('/admin', adminRouter)
apiRouter.use(healthRouter)
apiRouter.use(sitesRouter)
apiRouter.use(locationsRouter)
apiRouter.use(categoriesRouter)
apiRouter.use(assetsRouter)
apiRouter.use(workOrdersRouter)
apiRouter.use(pmSchedulesRouter)
apiRouter.use(pmTasksRouter)
apiRouter.use(complianceRouter)
apiRouter.use(inspectionsRouter)
apiRouter.use(devicesRouter)
apiRouter.use(integrationsRouter)
apiRouter.use(notificationsRouter)
apiRouter.use(reportsRouter)
apiRouter.use(auditRouter)
apiRouter.use(dashboardRouter)
apiRouter.use(orgRouter)
apiRouter.use(orgMembersRouter)
apiRouter.use(profileRouter)
apiRouter.use(licenceRouter)
