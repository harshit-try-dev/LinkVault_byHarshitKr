const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'
export const API_BASE_URL = configuredApiBaseUrl.replace(/\/+$/, '')
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

let csrfToken = ''

export class ApiError extends Error {
  constructor(message, { status = 0, code = 'API_ERROR' } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request(path, options = {}) {
  const headers = new Headers(options.headers)
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')
  const method = (options.method || 'GET').toUpperCase()
  if (!SAFE_METHODS.has(method) && path !== '/auth/csrf-token' && !csrfToken) {
    await getCsrfToken()
  }
  if (!SAFE_METHODS.has(method) && csrfToken) headers.set('X-CSRF-Token', csrfToken)
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...options, headers, credentials: 'include' })
  } catch {
    throw new ApiError('The LinkVault API could not be reached. Check that the server is running.')
  }
  let payload = null
  try { payload = await response.json() } catch { /* empty response */ }
  if (!response.ok) {
    throw new ApiError(payload?.error?.message || `The request failed with status ${response.status}.`, {
      status: response.status,
      code: payload?.error?.code || 'API_ERROR',
    })
  }
  return payload?.data
}

function queryString(parameters) {
  const query = new URLSearchParams()
  Object.entries(parameters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, value)
  })
  const result = query.toString()
  return result ? `?${result}` : ''
}

export function getShortUrl(shortCode) {
  const apiUrl = new URL(API_BASE_URL, window.location.origin)
  return new URL(`/${encodeURIComponent(shortCode)}`, apiUrl.origin).toString()
}

export async function getCsrfToken() {
  const result = await request('/auth/csrf-token')
  csrfToken = result.csrfToken
  return result
}

export function getSession() {
  return request('/auth/session')
}

export async function login(username, password) {
  await getCsrfToken()
  const result = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  csrfToken = ''
  await getCsrfToken()
  return result
}

export function register(username, password) {
  return request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
}

export async function logout() {
  const result = await request('/auth/logout', { method: 'POST' })
  csrfToken = ''
  return result
}

export function listLinks(parameters = {}) {
  return request(`/links${queryString({ page: parameters.page || 1, limit: parameters.limit || 100 })}`)
}

export async function listAllLinks() {
  const firstPage = await listLinks({ page: 1, limit: 100 })
  const pages = firstPage.pagination?.pages || 1
  if (pages <= 1) return { ...firstPage, items: firstPage.items.map(enrichLink) }
  const remainingPages = await Promise.all(
    Array.from({ length: pages - 1 }, (_, index) => listLinks({ page: index + 2, limit: 100 })),
  )
  return { ...firstPage, items: [firstPage, ...remainingPages].flatMap((page) => page.items).map(enrichLink) }
}

export function createLink(payload) {
  return request('/links', { method: 'POST', body: JSON.stringify(payload) }).then(enrichLink)
}

export function getLink(id) {
  return request(`/links/${encodeURIComponent(id)}`).then(enrichLink)
}

export function getAnalytics(id, range = {}) {
  return request(`/links/${encodeURIComponent(id)}/analytics${queryString(range)}`)
}

export function deleteLink(id) {
  return request(`/links/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(enrichLink)
}

function enrichLink(link) {
  return { ...link, shortUrl: link.shortUrl || getShortUrl(link.shortCode) }
}
