/**
 * Maintenance KPIs. Pure functions over rows the caller has already fetched —
 * no database, no request context — so each figure can be checked by hand
 * against the jobs it came from.
 *
 * Every function here returns its sample size and what it had to leave out.
 * An MTTR of "4.2 hours" computed from three jobs out of forty is not a
 * maintenance KPI, it is an accident waiting to be quoted in a board pack, and
 * the only defence is to publish the denominator next to the number.
 */

const MS_PER_HOUR = 1000 * 60 * 60

/** Work order shape the repair-time figures read. */
export type RepairRow = {
  actual_start: string | Date | null
  actual_end: string | Date | null
}

export type Mttr = {
  /** Mean hours from work starting to work finishing, or null if nothing qualified. */
  hours: number | null
  /** Jobs that had both clock stamps and so counted towards the mean. */
  sample_size: number
  /** Jobs in range that were skipped, and why they could not be used. */
  excluded: number
  note: string
}

const toMs = (v: string | Date | null): number | null => {
  if (!v) return null
  const t = v instanceof Date ? v.getTime() : Date.parse(v)
  return Number.isNaN(t) ? null : t
}

/**
 * Mean time to repair: how long a job takes once someone starts it.
 *
 * Measured start-to-finish, not raised-to-finish. A job that sat in the queue
 * for a week before anyone touched it says something about scheduling, not
 * about how long the repair takes, and mixing the two makes both useless.
 * Jobs whose clock was never stamped are excluded rather than guessed at.
 */
export function meanTimeToRepair(rows: RepairRow[]): Mttr {
  const durations: number[] = []
  let excluded = 0

  for (const row of rows) {
    const start = toMs(row.actual_start)
    const end = toMs(row.actual_end)
    // A negative duration means the stamps are the wrong way round; that is a
    // data problem, not a fast repair.
    if (start == null || end == null || end < start) { excluded++; continue }
    durations.push((end - start) / MS_PER_HOUR)
  }

  if (durations.length === 0) {
    return {
      hours: null,
      sample_size: 0,
      excluded,
      note: excluded > 0
        ? `No job in this period recorded both a start and an end time (${excluded} skipped).`
        : 'No corrective jobs were closed in this period.',
    }
  }

  const mean = durations.reduce((a, b) => a + b, 0) / durations.length
  return {
    hours: Math.round(mean * 100) / 100,
    sample_size: durations.length,
    excluded,
    note: excluded > 0
      ? `From ${durations.length} job${durations.length === 1 ? '' : 's'}; ${excluded} skipped for having no start or end time recorded.`
      : `From ${durations.length} job${durations.length === 1 ? '' : 's'}, all with both times recorded.`,
  }
}

export type MtbfInput = {
  /** Failures counted in the window — corrective and emergency jobs. */
  failures: number
  /** Calendar hours in the window, multiplied by the assets being watched. */
  calendar_hours: number
  /** Hours those assets spent down, from the jobs' own downtime figures. */
  downtime_hours: number
}

export type Mtbf = {
  /** Mean operating hours between one failure and the next, or null. */
  hours: number | null
  failures: number
  operating_hours: number
  /** Operating hours as a share of calendar hours, 0-100. */
  availability_percent: number | null
  note: string
}

/**
 * Mean time between failures: operating hours divided by failures.
 *
 * "Operating hours" is calendar time less recorded downtime, which is the
 * closest thing to running hours a system without meter readings can honestly
 * claim. It is stated in the note so nobody mistakes it for a runtime counter.
 *
 * With no failures MTBF is not infinite — it is unknown, because the window
 * was too short to observe one. Returning null and saying so beats a dash that
 * looks like a missing feature.
 */
export function meanTimeBetweenFailures(input: MtbfInput): Mtbf {
  const { failures, calendar_hours, downtime_hours } = input
  // Downtime can exceed calendar hours when several assets are down at once
  // and the window is short; clamp rather than report negative uptime.
  const operating = Math.max(0, calendar_hours - downtime_hours)
  const availability = calendar_hours > 0
    ? Math.round((operating / calendar_hours) * 1000) / 10
    : null

  if (failures === 0) {
    return {
      hours: null,
      failures: 0,
      operating_hours: Math.round(operating),
      availability_percent: availability,
      note: 'No failures were recorded in this period, so there is no interval to average.',
    }
  }

  return {
    hours: Math.round((operating / failures) * 10) / 10,
    failures,
    operating_hours: Math.round(operating),
    availability_percent: availability,
    note: `${failures} failure${failures === 1 ? '' : 's'} across ${Math.round(operating).toLocaleString()} operating hours `
      + '(calendar hours less recorded downtime).',
  }
}

/** Age buckets for open work, oldest last. */
export const BACKLOG_BUCKETS = [
  { key: '0_7', label: '0-7 days', min: 0, max: 7 },
  { key: '8_30', label: '8-30 days', min: 8, max: 30 },
  { key: '31_90', label: '31-90 days', min: 31, max: 90 },
  { key: 'over_90', label: 'Over 90 days', min: 91, max: Infinity },
] as const

export type BacklogRow = {
  created_at: string | Date
  priority: string
}

export type BacklogBucket = {
  key: string
  label: string
  count: number
  /** Of those, the ones nobody can afford to leave sitting. */
  critical: number
  oldest_days: number | null
}

/**
 * Open work by how long it has been open.
 *
 * A backlog of forty is a different problem depending on whether it is forty
 * jobs from last week or four from last year, which a single count cannot say.
 * Critical jobs are counted within each bucket for the same reason.
 */
export function bucketBacklog(rows: BacklogRow[], asOf: Date = new Date()): BacklogBucket[] {
  const buckets: BacklogBucket[] = BACKLOG_BUCKETS.map((b) => ({
    key: b.key, label: b.label, count: 0, critical: 0, oldest_days: null,
  }))

  for (const row of rows) {
    const created = toMs(row.created_at)
    if (created == null) continue
    // Floor, so a job raised this morning is 0 days old rather than rounding
    // up into tomorrow's bucket.
    const ageDays = Math.max(0, Math.floor((asOf.getTime() - created) / (MS_PER_HOUR * 24)))
    const index = BACKLOG_BUCKETS.findIndex((b) => ageDays >= b.min && ageDays <= b.max)
    if (index < 0) continue

    const bucket = buckets[index]
    bucket.count++
    if (row.priority === 'critical') bucket.critical++
    if (bucket.oldest_days == null || ageDays > bucket.oldest_days) bucket.oldest_days = ageDays
  }

  return buckets
}
