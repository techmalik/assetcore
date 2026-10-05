import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { app } from '../src/app.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const productVersion = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version

describe('system endpoints', () => {
  it('/api/health answers without a token', async () => {
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  // Support reads this to know what a client is running. It used to report
  // the API package's 1.0.0 while the product was 1.1.0.
  it('/api/version reports the product version', async () => {
    const res = await request(app).get('/api/version')
    expect(res.status).toBe(200)
    expect(res.body.version).toBe(productVersion)
    expect(res.body.latestMigration).toBeTruthy()
  })
})
