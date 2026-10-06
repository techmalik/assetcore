import { Router } from 'express'
import { coreRouter } from './core.js'
import { attachmentsRouter } from './attachments.js'
import { tasksRouter } from './tasks.js'
import { partsRouter } from './parts.js'

// Work orders, in four parts:
// - core.ts:        list, detail, create, edit, move (transition) and delete
// - attachments.ts: files and comments on a job's activity feed
// - tasks.ts:       the checklist a job is worked from
// - parts.ts:       the parts a job reserves and uses
// What a move does (parts drawn, defect resolved, health refreshed) is in
// services/workOrders.ts, which a maintenance completion also calls.
export const workOrdersRouter = Router()
workOrdersRouter.use(coreRouter, attachmentsRouter, tasksRouter, partsRouter)
