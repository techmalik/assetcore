/**
 * The API runs behind nginx on the VPS (deploy/nginx/nginx.conf forwards
 * X-Forwarded-For and X-Real-IP). Without `trust proxy`, Express resolves
 * req.ip to the proxy's own address for every caller, so express-rate-limit —
 * which keys on req.ip — gives the whole instance a single bucket.
 *
 * The login limiter is 10 per 15 minutes, counting successes. Shared, that
 * meant ten sign-ins by anyone locked out every user at once, and ten wrong
 * passwords from one person locked out everybody else. Found while writing the
 * production walkthrough; this test is here so the one line that fixes it
 * cannot be dropped again without something failing.
 */
import { describe, expect, it } from 'vitest'
import { app } from '../src/app.js'

describe('the API trusts exactly one proxy hop', () => {
  it('has trust proxy set, so req.ip is the caller rather than nginx', () => {
    expect(app.get('trust proxy')).toBe(1)
  })

  it('trusts one hop and no more, so X-Forwarded-For cannot be forged past it', () => {
    // A larger number (or `true`) would let a caller prepend addresses of their
    // own choosing and land in a bucket nobody else shares — which defeats the
    // limiter just as thoroughly as sharing one bucket did.
    expect(app.get('trust proxy')).not.toBe(true)
    expect(app.get('trust proxy')).toBeLessThanOrEqual(1)
  })
})
