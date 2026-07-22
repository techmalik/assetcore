import { config } from './config.js'
import { logger } from './logger.js'
import { app } from './app.js'
import { startJobs } from './jobs.js'

app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, tz: config.TZ }, 'AssetCore API listening')
  startJobs()
})
