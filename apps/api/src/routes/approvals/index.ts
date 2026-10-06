import { Router } from 'express'
import { rulesRouter } from './rules.js'
import { readRouter } from './read.js'
import { matrixRouter } from './matrix.js'
import { directRouter } from './direct.js'

// Approvals, in four parts:
// - rules.ts:  the approval matrix, who signs what at which amount (owner-run)
// - read.ts:   lists, counts, who a request can go to, one request
// - matrix.ts: submit, and approve, reject and recall a request
// - direct.ts: a request sent to a named person: forward, return, discard, resubmit
// Order matters for read.ts: /approvals/stats and /approvals/approvers are
// registered there before /approvals/:id.
export const approvalsRouter = Router()
approvalsRouter.use(rulesRouter, readRouter, matrixRouter, directRouter)
