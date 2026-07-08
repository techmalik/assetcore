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
