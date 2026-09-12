import 'dotenv/config'
import { z } from 'zod'

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_OWNER: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(8787),
  APP_ORIGIN: z.string().min(1),
  JWT_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('60m'),
  FILES_DIR: z.string().default('./data/files'),
  LOGS_DIR: z.string().default('./data/logs'),
  TZ: z.string().default('Africa/Lagos'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  // Implicit TLS. Left unset it follows the port (465 = on), which is what
  // every relay we've pointed this at expects. Compose passes unset variables
  // through as an empty string, so '' has to mean "unset" and not fail the
  // whole config parse.
  SMTP_SECURE: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.enum(['true', 'false']).transform((v) => v === 'true').optional()
  ),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().default('AssetCore <no-reply@assetcore.local>'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const config = parsed.data
export const isDev = config.NODE_ENV !== 'production'

// Set as early as possible — anything importing config.ts (which is nearly
// every module, transitively) gets the process-wide TZ before it runs any
// date logic. Previously set at the top of index.ts, but that ran after
// app.ts's import chain once the two were split for testability.
process.env.TZ = config.TZ
