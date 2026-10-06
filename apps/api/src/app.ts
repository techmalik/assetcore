import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { pinoHttp } from 'pino-http'
import { config, isDev } from './config.js'
import { logger } from './logger.js'
import { apiRouter } from './routes/index.js'

// Express app construction, split from index.ts's listen()/startJobs() so
// tests can drive it with supertest without binding a real port or
// scheduling cron jobs.
export const app = express()

// One proxy hop: deploy/nginx sits in front of this and forwards the caller's
// address in X-Forwarded-For. Without this, req.ip was nginx for every request,
// so express-rate-limit keyed its per-IP buckets on a single value and the
// login limiter became instance-wide — ten sign-ins in fifteen minutes locked
// out every user at once, and ten wrong passwords from any one person locked
// out everybody. Trusting exactly one hop is what the deployment has; trusting
// more would let a caller forge the header and choose their own bucket.
app.set('trust proxy', 1)

app.use(helmet())
if (isDev) {
  app.use(cors({ origin: config.APP_ORIGIN, credentials: true }))
}
app.use(cookieParser())
app.use(express.json())
app.use(pinoHttp({ logger }))

app.use('/api', apiRouter)

app.use((req, res) => {
  res.status(404).json({ error: 'not_found' })
})

// Postgres errors a client can cause with bad input, and the code to answer.
// Anything else is ours, and stays a 500.
const PG_CLIENT_ERRORS: Record<string, [number, string]> = {
  '22P02': [400, 'invalid_request'],    // not a valid uuid, number or enum value
  '22007': [400, 'invalid_request'],    // not a valid date
  '22008': [400, 'invalid_request'],    // date out of range
  '23505': [409, 'conflict'],           // unique violation (a duplicate)
  '23503': [422, 'invalid_reference'],  // points at a record that does not exist
  '23514': [422, 'invalid_request'],    // check constraint
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error & { status?: number; statusCode?: number; type?: string; code?: string }, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // Malformed JSON, an oversized body and other request-parsing failures
  // arrive with a 4xx status of their own; they were answered 500 and logged
  // as server errors.
  const status = err.status ?? err.statusCode
  if (status && status >= 400 && status < 500) {
    logger.warn({ err }, 'client error')
    const error = err.type === 'entity.parse.failed' ? 'invalid_json'
      : status === 413 ? 'payload_too_large'
      : 'invalid_request'
    return res.status(status).json({ error })
  }
  // A write outside the caller's sites or org, refused by a row-level
  // security policy's check, is the caller's mistake: 403, not 500. Only that
  // message: the same code also means a missing grant, which is ours.
  if (err.code === '42501' && /row-level security policy/.test(err.message)) {
    logger.warn({ err }, 'client error (outside the caller\'s scope)')
    return res.status(403).json({ error: 'forbidden' })
  }
  const pg = typeof err.code === 'string' ? PG_CLIENT_ERRORS[err.code] : undefined
  if (pg) {
    logger.warn({ err }, 'client error (database)')
    return res.status(pg[0]).json({ error: pg[1] })
  }
  logger.error({ err }, 'unhandled error')
  res.status(500).json({ error: 'internal_error' })
})
