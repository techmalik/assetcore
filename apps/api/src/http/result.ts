import type { Response } from 'express'

/** What a handler's transaction returns: the data, or an error code (plus
 * anything the client should see with it, such as the current status). */
export type Result<T, E extends string> = { data: T } | ({ error: E } & Record<string, unknown>)

/**
 * Answers a Result: `okStatus` with the data, or the status `statusFor` maps
 * the error code to, with the error and its extra fields. One table per route
 * group keeps every code's status in one readable place.
 */
export function send<T, E extends string>(
  res: Response, result: Result<T, E>, statusFor: Record<E, number>, okStatus = 200
) {
  if ('error' in result) {
    const { error, ...extra } = result
    return res.status(statusFor[error as E]).json({ error, ...extra })
  }
  return res.status(okStatus).json(result.data)
}
