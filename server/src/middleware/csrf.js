import { randomBytes, timingSafeEqual } from 'node:crypto'
import { HttpError } from '../utils/http-error.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const CSRF_SESSION_KEY = 'csrfToken'

export function createCsrfToken() {
  return randomBytes(32).toString('hex')
}

export function ensureCsrfToken(request) {
  if (!request.session[CSRF_SESSION_KEY]) {
    request.session[CSRF_SESSION_KEY] = createCsrfToken()
  }

  return request.session[CSRF_SESSION_KEY]
}

function tokensMatch(received, expected) {
  if (typeof received !== 'string' || typeof expected !== 'string') {
    return false
  }

  const receivedBuffer = Buffer.from(received)
  const expectedBuffer = Buffer.from(expected)
  return receivedBuffer.length === expectedBuffer.length && timingSafeEqual(receivedBuffer, expectedBuffer)
}

export function csrfTokenHandler(request, response) {
  response.json({ data: { csrfToken: ensureCsrfToken(request) } })
}

export function createOriginProtection(trustedOrigin) {
  return (request, _response, next) => {
    const origin = request.get('origin')
    if (origin && origin !== trustedOrigin) {
      next(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'The request origin is not allowed.'))
      return
    }

    next()
  }
}

export function csrfProtection(request, _response, next) {
  if (SAFE_METHODS.has(request.method)) {
    next()
    return
  }

  const token = request.get('x-csrf-token')
  if (!tokensMatch(token, request.session?.[CSRF_SESSION_KEY])) {
    next(new HttpError(403, 'CSRF_TOKEN_INVALID', 'A valid CSRF token is required.'))
    return
  }

  next()
}
