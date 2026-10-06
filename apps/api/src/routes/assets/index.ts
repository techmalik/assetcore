import { Router } from 'express'
import { coreRouter } from './core.js'
import { mediaRouter } from './media.js'

// Assets: core.ts holds the register (list, detail, create, edit, import,
// transfer, archive), media.ts its photos and documents. The derived figures
// (health, book value) are recomputed by services/assets.ts.
export const assetsRouter = Router()
assetsRouter.use(coreRouter, mediaRouter)
