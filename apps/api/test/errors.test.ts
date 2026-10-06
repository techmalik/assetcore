import request from 'supertest'
import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { app } from '../src/app.js'
import { USERS } from './fixtures.js'
import { apiAs, type Api } from './helpers.js'

let owner: Api

beforeAll(async () => {
  owner = await apiAs(USERS.ownerA.email)
})

// A client's mistake used to come back as 500 internal_error and be logged
// as a server fault, which also left the screen with nothing useful to say.
describe('client mistakes answer 4xx', () => {
  it('a malformed id in the path is 400, not 500', async () => {
    const res = await owner.get('/api/assets/not-a-uuid')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_request')
  })

  it('malformed JSON is 400 invalid_json', async () => {
    const res = await request(app).post('/api/auth/login').set('content-type', 'application/json').send('{"email":')
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('invalid_json')
  })

  it('a duplicate is 409 conflict', async () => {
    const name = `Duplicate test ${randomUUID().slice(0, 8)}`
    expect((await owner.post('/api/locations').send({ name })).status).toBe(201)
    const again = await owner.post('/api/locations').send({ name })
    expect(again.status).toBe(409)
    expect(again.body.error).toBe('conflict')
  })
})
