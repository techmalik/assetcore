import nodemailer from 'nodemailer'
import { config } from '../config.js'
import { logger } from '../logger.js'

const transport = config.SMTP_HOST
  ? nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASS } : undefined,
    })
  : null

export async function sendMail(opts: { to: string; subject: string; text: string }): Promise<void> {
  if (!transport) {
    logger.warn({ to: opts.to, subject: opts.subject }, 'SMTP not configured — printing email to console')
    console.log(`\n--- DEV EMAIL ---\nTo: ${opts.to}\nSubject: ${opts.subject}\n\n${opts.text}\n-----------------\n`)
    return
  }
  await transport.sendMail({ from: config.SMTP_FROM, to: opts.to, subject: opts.subject, text: opts.text })
}
