import { randomBytes } from 'node:crypto'
import type pg from 'pg'
import request from 'supertest'
import { app } from '../src/app.js'
import { FIXTURE_PASSWORD, ownerClient } from './fixtures.js'

/** Logs in as a seeded fixture user via the real /auth/login route (exercises
 * the actual auth stack, not a shortcut), then returns a small request
 * builder with the bearer token pre-attached — `api.get('/assets')` instead
 * of repeating the login + header dance in every test. */
export async function apiAs(email: string) {
  const res = await request(app).post('/api/auth/login').send({ email, password: FIXTURE_PASSWORD })
  if (res.status !== 200 || !res.body.accessToken) {
    throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`)
  }
  const token = res.body.accessToken as string
  const auth = (r: request.Test) => r.set('authorization', `Bearer ${token}`)
  return {
    get: (url: string) => auth(request(app).get(url)),
    post: (url: string) => auth(request(app).post(url)),
    put: (url: string) => auth(request(app).put(url)),
    patch: (url: string) => auth(request(app).patch(url)),
    delete: (url: string) => auth(request(app).delete(url)),
    token,
  }
}

/** What apiAs() resolves to: a request builder signed in as one fixture user. */
export type Api = Awaited<ReturnType<typeof apiAs>>

/** A few random hex bytes, to keep test names, codes and AINs unique. */
export function uniqueSuffix(): string {
  return randomBytes(4).toString('hex')
}

/** Runs `fn` with an owner-pool client (no RLS: setup and checks, not the
 * thing under test), and always closes it. */
export async function withClient<T>(fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = ownerClient()
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}
