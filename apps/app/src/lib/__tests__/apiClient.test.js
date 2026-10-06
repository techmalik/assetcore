// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, qs, setAccessToken } from '../apiClient'

describe('qs', () => {
  it('leaves out unset filters and the "all" option', () => {
    expect(qs({ status: 'all', q: '', asset_id: null, site_id: undefined, open: false })).toBe('')
  })

  it('encodes values and joins arrays', () => {
    expect(qs({ q: 'a&b c', statuses: ['online', 'error'], limit: 0, open: true }))
      .toBe('?q=a%26b+c&statuses=online%2Cerror&limit=0&open=true')
  })

  it('leaves out an empty array', () => {
    expect(qs({ statuses: [] })).toBe('')
  })
})

describe('file fetches', () => {
  afterEach(() => { vi.unstubAllGlobals(); setAccessToken(null) })

  it('refresh the token and retry once on a 401', async () => {
    setAccessToken('stale')
    const seen = []
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      seen.push(`${url} ${init?.headers?.Authorization ?? ''}`)
      if (url.endsWith('/auth/refresh')) return new Response(JSON.stringify({ accessToken: 'fresh' }), { status: 200 })
      if (init.headers.Authorization === 'Bearer stale') return new Response(null, { status: 401 })
      return new Response('png-bytes', { status: 200 })
    }))
    vi.stubGlobal('URL', { ...URL, createObjectURL: () => 'blob:x', revokeObjectURL: () => {} })

    await expect(api.blobUrl('/files/org/a.png')).resolves.toBe('blob:x')
    expect(seen).toEqual([
      '/api/files/org/a.png Bearer stale',
      '/api/auth/refresh ',
      '/api/files/org/a.png Bearer fresh',
    ])
  })

  it('throw an error with the server code', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404 })))
    await expect(api.raw('/files/org/missing.pdf')).rejects.toMatchObject({ status: 404, code: 'not_found' })
  })
})

describe('every call shape', () => {
  afterEach(() => { vi.unstubAllGlobals(); setAccessToken(null) })

  /** A server where 'stale' is expired, 'fresh' works, and every call is logged. */
  function server(handler) {
    const seen = []
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      seen.push(`${init.method ?? 'GET'} ${url} ${init.headers?.Authorization ?? ''}`)
      if (url.endsWith('/auth/refresh')) return new Response(JSON.stringify({ accessToken: 'fresh' }), { status: 200 })
      if (init.headers?.Authorization === 'Bearer stale') return new Response(null, { status: 401 })
      return handler(url, init)
    }))
    return seen
  }

  it('a JSON request refreshes once on a 401', async () => {
    setAccessToken('stale')
    const seen = server(() => new Response(JSON.stringify({ ok: 1 }), { status: 200 }))
    await expect(api.post('/things', { a: 1 })).resolves.toEqual({ ok: 1 })
    expect(seen).toEqual(['POST /api/things Bearer stale', 'POST /api/auth/refresh ', 'POST /api/things Bearer fresh'])
  })

  it('an upload refreshes once and keeps the shortfalls of a refusal', async () => {
    setAccessToken('stale')
    server(() => new Response(JSON.stringify({ error: 'insufficient_stock', shortfalls: [{ part_number: 'X' }] }), { status: 409 }))
    const err = await api.upload('/assets/1/maintenance-completions', new FormData()).catch((e) => e)
    expect(err).toMatchObject({ status: 409, code: 'insufficient_stock', shortfalls: [{ part_number: 'X' }] })
  })

  it('a 204 answers null', async () => {
    server(() => new Response(null, { status: 204 }))
    await expect(api.del('/things/1')).resolves.toBeNull()
  })
})
