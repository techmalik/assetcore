import { afterEach, describe, expect, it, vi } from 'vitest'

// Without an SMTP relay the mailer used to print every email, invite and
// reset links included, to the server's output in production as well as in
// development. Those links are live sign-in tokens.

const reset = { to: 'someone@example.test', subject: 'Reset your password', text: 'https://app.example/reset-password?token=SECRET-TOKEN' }

async function mailerIn(env: 'production' | 'development') {
  vi.resetModules()
  vi.stubEnv('NODE_ENV', env)
  vi.stubEnv('SMTP_HOST', '')
  return import('../src/auth/mailer.js')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('sending mail with no relay configured', () => {
  it('never prints the email in production', async () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { sendMail } = await mailerIn('production')
    expect(await sendMail(reset)).toEqual({ delivered: false })
    expect(out.mock.calls.flat().join(' ')).not.toContain('SECRET-TOKEN')
  })

  it('prints it in development, so the link can be followed', async () => {
    const out = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { sendMail } = await mailerIn('development')
    expect(await sendMail(reset)).toEqual({ delivered: false })
    expect(out.mock.calls.flat().join(' ')).toContain('SECRET-TOKEN')
  })
})
