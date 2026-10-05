// Rescores asset health with the same engine as the nightly job, on demand.
//
//   npm run rescore:health -w @assetcore/api [-- <org id>]
//
// scripts/seed-dev.mjs runs this after seeding, so a fresh dev database
// carries production's five-signal scores rather than a seeded number.
import { ownerPool } from '../db.js'
import { recomputeAllHealthScores } from '../healthService.js'

const orgId = process.argv[2] || undefined

try {
  const n = await recomputeAllHealthScores(ownerPool, orgId)
  console.log(`assets rescored: ${n}`)
} finally {
  await ownerPool.end()
}
