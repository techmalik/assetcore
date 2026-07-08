import { Router } from 'express'
import { authRouter } from '../auth/routes.js'
import { healthRouter } from './health.js'

// Phase 1+ mounts assets/sites/workOrders/pm/compliance/... routers here,
// each wrapping db.ts's withOrgContext() and guarded by requireAuth + requireCap.
export const apiRouter = Router()

apiRouter.use('/auth', authRouter)
apiRouter.use(healthRouter)
