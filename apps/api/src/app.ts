import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { pinoHttp } from 'pino-http'
import { config, isDev } from './config.js'
import { logger } from './logger.js'
import { apiRouter } from './routes/index.js'
import { filesRouter } from './files.js'

// Express app construction, split from index.ts's listen()/startJobs() so
// tests can drive it with supertest without binding a real port or
// scheduling cron jobs.
export const app = express()

app.use(helmet())
if (isDev) {
  app.use(cors({ origin: config.APP_ORIGIN, credentials: true }))
}
app.use(cookieParser())
app.use(express.json())
app.use(pinoHttp({ logger }))

app.use('/api', apiRouter)
app.use('/api', filesRouter)

app.use((req, res) => {
  res.status(404).json({ error: 'not_found' })
})

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error({ err }, 'unhandled error')
  res.status(500).json({ error: 'internal_error' })
})
