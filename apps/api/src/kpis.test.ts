import { describe, it, expect } from 'vitest'
import { meanTimeToRepair, meanTimeBetweenFailures, bucketBacklog, BACKLOG_BUCKETS } from './kpis.js'

/**
 * These figures end up in board packs, so the thing worth defending is not the
 * arithmetic — it is that every one of them publishes its own denominator, and
 * that "we cannot say" is reported as such rather than as a zero or a dash.
 */

const hoursAgo = (h: number) => new Date(Date.UTC(2026, 8, 6, 12) - h * 3_600_000).toISOString()
const AS_OF = new Date(Date.UTC(2026, 8, 6, 12))
const daysAgo = (d: number) => new Date(AS_OF.getTime() - d * 24 * 3_600_000).toISOString()

describe('meanTimeToRepair', () => {
  it('averages start-to-finish across the jobs that recorded both', () => {
    const result = meanTimeToRepair([
      { actual_start: hoursAgo(10), actual_end: hoursAgo(8) },   // 2h
      { actual_start: hoursAgo(10), actual_end: hoursAgo(6) },   // 4h
      { actual_start: hoursAgo(10), actual_end: hoursAgo(4) },   // 6h
    ])
    expect(result.hours).toBe(4)
    expect(result.sample_size).toBe(3)
    expect(result.excluded).toBe(0)
  })

  it('excludes a job with no clock rather than guessing at one', () => {
    const result = meanTimeToRepair([
      { actual_start: hoursAgo(10), actual_end: hoursAgo(8) },   // 2h
      { actual_start: hoursAgo(10), actual_end: hoursAgo(6) },   // 4h
      { actual_start: null, actual_end: hoursAgo(4) },
      { actual_start: hoursAgo(10), actual_end: null },
    ])
    expect(result.hours).toBe(3)
    expect(result.sample_size).toBe(2)
    expect(result.excluded).toBe(2)
  })

  it('says in the note how many it had to skip', () => {
    const result = meanTimeToRepair([
      { actual_start: hoursAgo(4), actual_end: hoursAgo(2) },
      { actual_start: null, actual_end: null },
    ])
    // The denominator has to travel with the number, or the number gets
    // repeated without it.
    expect(result.note).toContain('1 job')
    expect(result.note).toContain('1 skipped')
  })

  it('treats a job that finished before it started as bad data, not a fast repair', () => {
    const result = meanTimeToRepair([{ actual_start: hoursAgo(2), actual_end: hoursAgo(6) }])
    expect(result.hours).toBeNull()
    expect(result.excluded).toBe(1)
  })

  it('is null with nothing to average, and distinguishes empty from unusable', () => {
    expect(meanTimeToRepair([]).hours).toBeNull()
    expect(meanTimeToRepair([]).note).toContain('No corrective jobs were closed')

    const unusable = meanTimeToRepair([{ actual_start: null, actual_end: null }])
    expect(unusable.hours).toBeNull()
    expect(unusable.note).toContain('1 skipped')
  })

  it('accepts Date objects as well as strings, since pg hands back both', () => {
    const result = meanTimeToRepair([
      { actual_start: new Date(hoursAgo(5)), actual_end: new Date(hoursAgo(2)) },
    ])
    expect(result.hours).toBe(3)
  })
})

describe('meanTimeBetweenFailures', () => {
  it('divides operating hours by failures', () => {
    const result = meanTimeBetweenFailures({ failures: 3, calendar_hours: 2184, downtime_hours: 12 })
    expect(result.operating_hours).toBe(2172)
    expect(result.hours).toBe(724)
    expect(result.availability_percent).toBe(99.5)
  })

  it('reports no failures as unknown, not as infinity or zero', () => {
    // A window too short to observe a failure tells you nothing about the
    // interval between them, and a dash reads like a broken feature.
    const result = meanTimeBetweenFailures({ failures: 0, calendar_hours: 720, downtime_hours: 0 })
    expect(result.hours).toBeNull()
    expect(result.note).toContain('No failures were recorded')
    // Availability is still knowable, and still worth reporting.
    expect(result.availability_percent).toBe(100)
  })

  it('clamps operating hours at zero when downtime exceeds the window', () => {
    // Several assets down at once in a short window can outrun calendar time;
    // negative uptime is not a thing.
    const result = meanTimeBetweenFailures({ failures: 2, calendar_hours: 100, downtime_hours: 500 })
    expect(result.operating_hours).toBe(0)
    expect(result.hours).toBe(0)
    expect(result.availability_percent).toBe(0)
  })

  it('has no availability to report when the window has no hours in it', () => {
    const result = meanTimeBetweenFailures({ failures: 0, calendar_hours: 0, downtime_hours: 0 })
    expect(result.availability_percent).toBeNull()
  })

  it('states the basis, so operating hours are not mistaken for a runtime counter', () => {
    const result = meanTimeBetweenFailures({ failures: 1, calendar_hours: 1000, downtime_hours: 100 })
    expect(result.note).toContain('calendar hours less recorded downtime')
  })
})

describe('bucketBacklog', () => {
  it('puts each job in exactly one bucket', () => {
    const rows = [0, 3, 7, 8, 20, 30, 31, 60, 90, 91, 400].map((d) => ({ created_at: daysAgo(d), priority: 'medium' }))
    const buckets = bucketBacklog(rows, AS_OF)
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(rows.length)
  })

  it('places jobs on the bucket boundaries where the labels say', () => {
    const at = (days: number) => {
      const buckets = bucketBacklog([{ created_at: daysAgo(days), priority: 'low' }], AS_OF)
      return buckets.find((b) => b.count === 1)!.key
    }
    expect(at(0)).toBe('0_7')
    expect(at(7)).toBe('0_7')
    expect(at(8)).toBe('8_30')
    expect(at(30)).toBe('8_30')
    expect(at(31)).toBe('31_90')
    expect(at(90)).toBe('31_90')
    expect(at(91)).toBe('over_90')
  })

  it('counts a job raised this morning as nought days old, not one', () => {
    const buckets = bucketBacklog([{ created_at: new Date(AS_OF.getTime() - 3_600_000).toISOString(), priority: 'low' }], AS_OF)
    expect(buckets[0].count).toBe(1)
    expect(buckets[0].oldest_days).toBe(0)
  })

  it('counts critical jobs within each bucket, not just overall', () => {
    const buckets = bucketBacklog([
      { created_at: daysAgo(2), priority: 'critical' },
      { created_at: daysAgo(3), priority: 'medium' },
      { created_at: daysAgo(200), priority: 'critical' },
    ], AS_OF)
    expect(buckets.find((b) => b.key === '0_7')!.critical).toBe(1)
    expect(buckets.find((b) => b.key === 'over_90')!.critical).toBe(1)
  })

  it('reports the oldest job in each bucket', () => {
    const buckets = bucketBacklog([
      { created_at: daysAgo(2), priority: 'low' },
      { created_at: daysAgo(6), priority: 'low' },
    ], AS_OF)
    expect(buckets[0].oldest_days).toBe(6)
  })

  it('returns every bucket even when empty, so the chart keeps its shape', () => {
    const buckets = bucketBacklog([], AS_OF)
    expect(buckets).toHaveLength(BACKLOG_BUCKETS.length)
    for (const b of buckets) {
      expect(b.count).toBe(0)
      expect(b.oldest_days).toBeNull()
    }
  })

  it('ignores a row with an unreadable date rather than bucketing it as ancient', () => {
    const buckets = bucketBacklog([{ created_at: 'not a date', priority: 'low' }], AS_OF)
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(0)
  })
})
