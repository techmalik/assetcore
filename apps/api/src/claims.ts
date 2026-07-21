import type { Request } from 'express'
import type { Claims } from './db.js'

export function claimsFromReq(req: Request): Claims {
  return {
    userId: req.claims?.sub ?? null,
    orgId: req.claims?.org_id ?? null,
    roleKey: req.claims?.role_key ?? null,
    siteIds: req.claims?.site_ids ?? null,
  }
}
