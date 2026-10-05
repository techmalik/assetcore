import { z } from 'zod'

// Field shapes many routes repeat. Use these instead of a fresh regex.

/** A calendar date as the API exchanges it: 'YYYY-MM-DD'. */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

/** For multipart forms, where an empty input arrives as '' rather than absent. */
export const blankToUndefined = (v: unknown) => (v === '' ? undefined : v)
