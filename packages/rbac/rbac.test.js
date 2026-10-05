import { describe, it, expect } from 'vitest'
import { can, ROLE_KEYS } from './index.js'

describe('can', () => {
  it('allows what the role lists', () => {
    expect(can('auditor', 'audit:read')).toBe(true)
  })

  it('a per-user grant allows a capability the role lacks', () => {
    expect(can('viewer', 'risk:create')).toBe(false)
    expect(can('viewer', 'risk:create', ['risk:create'])).toBe(true)
  })

  it('*:read covers business reads but not the audit log', () => {
    expect(can('viewer', 'asset:read')).toBe(true)
    expect(can('viewer', 'audit:read')).toBe(false)
  })

  it('*:read never grants a write', () => {
    expect(can('viewer', 'asset:update')).toBe(false)
  })

  it('the owner holds owner-only capabilities through *', () => {
    expect(can('owner', 'depreciation:manage')).toBe(true)
    expect(can('owner', 'integration:manage')).toBe(true)
    expect(can('admin', 'integration:manage')).toBe(false)
  })

  it('an unknown or missing role is denied', () => {
    expect(can('nobody', 'asset:read')).toBe(false)
    expect(can(null, 'asset:read')).toBe(false)
  })

  it('every listed role key resolves to a capability list', () => {
    for (const role of ROLE_KEYS) expect(can(role, 'asset:read')).toBe(true)
  })
})
