import { beforeAll } from 'vitest'
import { seedFixtures } from './fixtures.js'

// Runs in every test file (vitest setupFiles): the fixture orgs, users,
// sites and assets every file relies on. seedFixtures is idempotent, so
// this costs one check per file after the first.
beforeAll(async () => {
  await seedFixtures()
})
