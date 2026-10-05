import type { Response } from 'express'
import type { z } from 'zod'

/**
 * Parses `value` with `schema`, or answers 400 and returns undefined. The 400
 * names the fields that failed: the plain `invalid_request` the routes used to
 * send left a client guessing which field it got wrong.
 *
 *   const q = parseOr400(listInput, req.query, res); if (!q) return
 */
export function parseOr400<S extends z.ZodTypeAny>(schema: S, value: unknown, res: Response): z.infer<S> | undefined {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  res.status(400).json({ error: 'invalid_request', fields: parsed.error.flatten().fieldErrors })
  return undefined
}
