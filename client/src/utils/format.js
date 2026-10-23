export function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value))
}

export function formatDateTime(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function isExpired(expiresAt) {
  return Boolean(expiresAt && new Date(expiresAt).getTime() <= Date.now())
}

export function toUtcBoundary(value) {
  if (!value) return ''
  if (value.length === 10) return `${value}T00:00:00.000Z`
  return new Date(value).toISOString()
}

export function sumClicks(links) {
  return links.reduce((total, link) => total + (Number(link.clickCount) || 0), 0)
}
