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
