// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// The device is offline while an expired token is refreshed: fetch throws,
// so getSession() rejects.
vi.mock('../auth', () => ({
  getSession: () => Promise.reject(new TypeError('Failed to fetch')),
  onAuthStateChange: () => ({ unsubscribe() {} }),
  getOrgRole: () => ({ orgId: null, roleKey: null, extraCaps: [] }),
  signOut: () => Promise.resolve(),
}))

const { AuthProvider, useAuth } = await import('../AuthContext.jsx')

function Probe() {
  const { loading, authed } = useAuth()
  return <span>{loading ? 'loading' : authed ? 'signed in' : 'signed out'}</span>
}

describe('AuthProvider', () => {
  it('stops loading and treats the user as signed out when the session cannot be fetched', async () => {
    render(<AuthProvider><Probe /></AuthProvider>)
    // Before the fix this stayed on 'loading' for good: the splash screen.
    await waitFor(() => expect(screen.getByText('signed out')).toBeTruthy())
  })
})
