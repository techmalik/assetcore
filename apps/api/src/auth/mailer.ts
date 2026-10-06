import nodemailer from 'nodemailer'
import { config, isDev } from '../config.js'
import { logger } from '../logger.js'

const transport = config.SMTP_HOST
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      // Implicit TLS on 465, STARTTLS on 587/25. Without this, a relay that
      // only speaks TLS on 465 (SendGrid and Resend both offer it) hangs until
      // the socket times out rather than failing with anything readable.
      secure: config.SMTP_SECURE ?? config.SMTP_PORT === 465,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    })
  : null

/** Sends if a relay is configured; otherwise reports that it was not
 * delivered, so the caller can fall back to showing the link.
 *
 * Without a relay, development prints the email so the link can be followed.
 * Production never does: invite and reset emails carry live sign-in tokens,
 * and printing them put working links in the server's logs for anyone who can
 * read them. The admin screens show those links to the admin instead. */
export async function sendMail(opts: { to: string; subject: string; text: string }): Promise<{ delivered: boolean }> {
  if (!transport) {
    if (isDev) {
      logger.warn({ to: opts.to, subject: opts.subject }, 'SMTP not configured — printing email to console')
      console.log(`\n--- DEV EMAIL ---\nTo: ${opts.to}\nSubject: ${opts.subject}\n\n${opts.text}\n-----------------\n`)
    } else {
      logger.warn({ to: opts.to, subject: opts.subject }, 'SMTP not configured — email not sent')
    }
    return { delivered: false }
  }
  try {
    await transport.sendMail({ from: config.SMTP_FROM, to: opts.to, subject: opts.subject, text: opts.text })
    return { delivered: true }
  } catch (err) {
    // A relay outage must not roll back the invite or the reset that was just
    // written — the caller still has a link to hand over.
    logger.error({ err, to: opts.to, subject: opts.subject }, 'SMTP delivery failed')
    return { delivered: false }
  }
}
