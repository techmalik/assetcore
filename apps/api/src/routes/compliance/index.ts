import { Router } from 'express'
import { licencesRouter } from './licences.js'
import { auditsRouter } from './audits.js'
import { findingsRouter } from './findings.js'

// Compliance: licences (documents with an expiry, and PM compliance), audits
// (someone comes and checks, and the outcome), and an audit's findings, which
// can be raised as defects.
export const complianceRouter = Router()
complianceRouter.use(licencesRouter, auditsRouter, findingsRouter)
