const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_RANGE_MS = 30 * DAY_MS
const MAX_RANGE_MS = 366 * DAY_MS

export class DateRangeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'DateRangeError'
  }
}

function parseBoundary(value, name) {
  if (value === undefined || value === '') {
    return null
  }

  if (Array.isArray(value) || typeof value !== 'string') {
    throw new DateRangeError(`${name} must be a valid date.`)
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new DateRangeError(`${name} must be a valid date.`)
  }

  return parsed
}

export function parseAnalyticsRange({ from, to } = {}, now = new Date()) {
  const fromDate = parseBoundary(from, 'from')
  const toDate = parseBoundary(to, 'to')

  if (!fromDate && !toDate) {
    return {
      from: new Date(now.getTime() - DEFAULT_RANGE_MS),
      to: new Date(now.getTime()),
    }
  }

  if (fromDate && !toDate) {
    return {
      from: fromDate,
      to: new Date(fromDate.getTime() + MAX_RANGE_MS),
    }
  }

  if (!fromDate && toDate) {
    return {
      from: new Date(toDate.getTime() - MAX_RANGE_MS),
      to: toDate,
    }
  }

  if (fromDate.getTime() >= toDate.getTime()) {
    throw new DateRangeError('from must be earlier than to.')
  }

  if (toDate.getTime() - fromDate.getTime() > MAX_RANGE_MS) {
    throw new DateRangeError('The requested date range cannot exceed 366 days.')
  }

  return { from: fromDate, to: toDate }
}

