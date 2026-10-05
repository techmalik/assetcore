// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useResource } from '../useResource.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('useResource', () => {
  it('keeps the newest answer when an older request finishes last', async () => {
    const calls = {}
    const fetcher = (key) => { calls[key] = deferred(); return calls[key].promise }
    const { result, rerender } = renderHook(({ key }) => useResource(() => fetcher(key), [key]), { initialProps: { key: 'A' } })
    await waitFor(() => expect(calls.A).toBeTruthy())
    rerender({ key: 'B' })
    await waitFor(() => expect(calls.B).toBeTruthy())
    await act(async () => { calls.B.resolve('answer B') })
    await act(async () => { calls.A.resolve('answer A') }) // the slow, stale one
    expect(result.current.data).toBe('answer B')
    expect(result.current.loading).toBe(false)
  })

  it('turns a failure into a sentence', async () => {
    const err = Object.assign(new Error('forbidden'), { code: 'forbidden' })
    const { result } = renderHook(() => useResource(() => Promise.reject(err), [], {
      errorFallback: 'Failed.', overrides: { forbidden: 'Your role cannot see this.' },
    }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBe('Your role cannot see this.')
  })

  it('reload fetches again and keeps rows on screen when asked to', async () => {
    let n = 0
    const { result } = renderHook(() => useResource(() => Promise.resolve(++n), [], { keepPrevious: true }))
    await waitFor(() => expect(result.current.data).toBe(1))
    let during
    await act(async () => { const p = result.current.reload(); during = result.current.data; await p })
    expect(during).toBe(1)
    expect(result.current.data).toBe(2)
  })
})
