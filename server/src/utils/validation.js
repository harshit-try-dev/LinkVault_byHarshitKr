export function isValidHttpUrl(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    return false
  }

  try {
    const parsed = new URL(value.trim())
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      Boolean(parsed.hostname) &&
      !parsed.username &&
      !parsed.password
    )
  } catch {
    return false
  }
}

export function isExpired(expiresAt, now = new Date()) {
  if (expiresAt === null || expiresAt === undefined) {
    return false
  }

  const expiry = expiresAt instanceof Date ? expiresAt : new Date(expiresAt)
  if (Number.isNaN(expiry.getTime())) {
    return false
  }

  return expiry.getTime() <= now.getTime()
}

