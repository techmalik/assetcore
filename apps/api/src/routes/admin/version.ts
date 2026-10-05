import { Router } from 'express'
import { versionInfo } from '../../version.js'

export const adminVersionRouter = Router()

// Same data as the public /api/version, mounted under /admin so support staff
// can confirm a client instance's build during a support session without
// needing an unauthenticated probe endpoint.
adminVersionRouter.get('/version', async (_req, res) => {
  res.json(await versionInfo())
})
