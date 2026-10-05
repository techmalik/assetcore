import { afterEach, describe, expect, it, vi } from 'vitest'
import { todayISO, addDaysISO, toISODate, parseISODate, fmtDate, fmtDateLong, fmtDateTime } from '../dates.js'

// vitest.config.js runs these under TZ=Africa/Lagos (UTC+1).
afterEach(() => vi.useRealTimers())

describe('todayISO', () => {
  it('is the local date, not the UTC one, in the hour after midnight', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-05T23:30:00Z')) // 00:30 on the 6th in Lagos
    expect(todayISO()).toBe('2026-10-06')
  })
})

describe('date arithmetic', () => {
  it('moves across month and year ends', () => {
    expect(addDaysISO('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysISO('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('a date string round-trips on the local calendar', () => {
    expect(toISODate(parseISODate('2026-10-05'))).toBe('2026-10-05')
  })
})

describe('formatting', () => {
  it('formats a date-only value as that calendar day', () => {
    expect(fmtDate('2026-10-05')).toBe('5 Oct 26')
    expect(fmtDateLong('2026-10-05')).toBe('5 Oct 2026')
  })

  it('shows a dash, or the given placeholder, for no value', () => {
    expect(fmtDate(null)).toBe('—')
    expect(fmtDateTime(null, '')).toBe('')
  })
})
