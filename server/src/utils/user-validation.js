const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/
export const MIN_USERNAME_LENGTH = 3
export const MAX_USERNAME_LENGTH = 32
export const MIN_USER_PASSWORD_LENGTH = 12

export function normalizeUsername(value) {
  if (typeof value !== 'string') return null
  const username = value.trim().toLowerCase()
  if (username.length < MIN_USERNAME_LENGTH || username.length > MAX_USERNAME_LENGTH || !USERNAME_PATTERN.test(username)) return null
  return username
}

export function isValidUserPassword(value) {
  return typeof value === 'string' && value.length >= MIN_USER_PASSWORD_LENGTH && value.length <= 256
}
