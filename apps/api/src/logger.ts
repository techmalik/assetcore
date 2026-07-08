import pino from 'pino'
import { config, isDev } from './config.js'

const targets: pino.TransportTargetOptions[] = [
  {
    target: 'pino-roll',
    level: 'info',
    options: { file: `${config.LOGS_DIR}/api`, frequency: 'daily', extension: '.log', mkdir: true },
  },
]

if (isDev) {
  targets.unshift({ target: 'pino-pretty', level: 'debug', options: { colorize: true } })
}

export const logger = pino({ level: isDev ? 'debug' : 'info' }, pino.transport({ targets }))

