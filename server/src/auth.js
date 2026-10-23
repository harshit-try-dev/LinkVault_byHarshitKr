import bcrypt from 'bcryptjs'
import { Router } from 'express'
import { ensureCsrfToken } from './middleware/csrf.js'
import { User } from './models/user.model.js'
import { HttpError } from './utils/http-error.js'
import { isValidUserPassword, normalizeUsername } from './utils/user-validation.js'

const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_FAILURES = 5
const AUTHENTICATION_ERROR = new HttpError(401, 'AUTHENTICATION_FAILED', 'Invalid username or password.')

function saveSession(request) {
  return new Promise((resolve, reject) => {
    request.session.save((error) => (error ? reject(error) : resolve()))
  })
}

function regenerateSession(request) {
  return new Promise((resolve, reject) => {
    request.session.regenerate((error) => (error ? reject(error) : resolve()))
  })
}

function destroySession(request) {
  return new Promise((resolve, reject) => {
    request.session.destroy((error) => (error ? reject(error) : resolve()))
  })
}

export function createLoginRateLimiter({
  maxFailures = LOGIN_MAX_FAILURES,
  windowMs = LOGIN_WINDOW_MS,
  now = () => Date.now(),
} = {}) {
  const failures = new Map()

  function getEntry(key) {
    const current = failures.get(key)
    if (!current || now() - current.startedAt >= windowMs) {
      const fresh = { startedAt: now(), count: 0 }
      failures.set(key, fresh)
      return fresh
    }

    return current
  }

  return {
    isLimited(key) {
      return getEntry(key).count >= maxFailures
    },
    recordFailure(key) {
      const entry = getEntry(key)
      entry.count += 1
    },
    reset(key) {
      failures.delete(key)
    },
  }
}

export function requireAuthenticatedSession(request, _response, next) {
  const sessionUser = request.session?.user
  const role = sessionUser?.role || 'admin'
  const validUser = sessionUser?.username
    && (role === 'admin' || (role === 'user' && sessionUser.userId))

  if (!validUser) {
    next(new HttpError(401, 'AUTHENTICATION_REQUIRED', 'An authenticated session is required.'))
    return
  }

  next()
}

export function createAuthRouter({
  adminUsername,
  adminPasswordHash,
  UserModel = User,
  loginRateLimiter = createLoginRateLimiter(),
  registrationRateLimiter = createLoginRateLimiter(),
  clearSessionCookie,
} = {}) {
  const router = Router()

  function publicUser(sessionUser) {
    return {
      username: sessionUser.username,
      role: sessionUser.role || 'admin',
    }
  }

  async function saveAuthenticatedSession(request, identity) {
    await regenerateSession(request)
    request.session.user = identity
    ensureCsrfToken(request)
    await saveSession(request)
  }

  router.get('/csrf-token', (request, response) => {
    response.json({ data: { csrfToken: ensureCsrfToken(request) } })
  })

  router.post('/register', async (request, response, next) => {
    const key = request.ip || 'unknown'
    if (registrationRateLimiter.isLimited(key)) {
      next(new HttpError(429, 'REGISTRATION_RATE_LIMITED', 'Too many registration attempts. Try again later.'))
      return
    }

    const body = request.body && typeof request.body === 'object' ? request.body : {}
    const username = normalizeUsername(body.username)
    const password = typeof body.password === 'string' ? body.password : ''
    const reservedAdminUsername = normalizeUsername(adminUsername) || String(adminUsername || '').trim().toLowerCase()

    if (!username || !isValidUserPassword(password)) {
      registrationRateLimiter.recordFailure(key)
      next(new HttpError(422, 'INVALID_REGISTRATION', 'Choose a valid username and password.'))
      return
    }

    if (username === reservedAdminUsername) {
      registrationRateLimiter.recordFailure(key)
      next(new HttpError(409, 'USERNAME_UNAVAILABLE', 'That username is unavailable.'))
      return
    }

    try {
      await UserModel.create({
        username,
        passwordHash: await bcrypt.hash(password, 12),
      })
      registrationRateLimiter.reset(key)
      response.status(201).json({
        data: {
          registered: true,
          user: { username, role: 'user' },
        },
      })
    } catch (error) {
      if (error?.code === 11000) {
        registrationRateLimiter.recordFailure(key)
        next(new HttpError(409, 'USERNAME_UNAVAILABLE', 'That username is unavailable.'))
        return
      }
      next(error)
    }
  })

  router.post('/login', async (request, response, next) => {
    const key = request.ip || 'unknown'
    if (loginRateLimiter.isLimited(key)) {
      next(new HttpError(429, 'LOGIN_RATE_LIMITED', 'Too many failed login attempts. Try again later.'))
      return
    }

    const body = request.body && typeof request.body === 'object' ? request.body : {}
    const username = typeof body.username === 'string' ? body.username.trim() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    let identity = null

    if (username === adminUsername) {
      const passwordMatches = await bcrypt.compare(password, adminPasswordHash)
      if (passwordMatches) identity = { username: adminUsername, role: 'admin' }
    } else {
      const normalizedUsername = normalizeUsername(username)
      let user = null
      if (normalizedUsername) {
        const query = UserModel.findOne({ username: normalizedUsername })
        user = await (typeof query?.select === 'function' ? query.select('+passwordHash') : query)
      }

      const passwordMatches = await bcrypt.compare(password, user?.passwordHash || adminPasswordHash)
      if (user && passwordMatches) {
        identity = { userId: String(user._id), username: user.username, role: 'user' }
      }
    }

    if (!identity) {
      loginRateLimiter.recordFailure(key)
      next(AUTHENTICATION_ERROR)
      return
    }

    try {
      await saveAuthenticatedSession(request, identity)
      loginRateLimiter.reset(key)
      response.json({ data: { authenticated: true, user: publicUser(identity) } })
    } catch (error) {
      next(error)
    }
  })

  router.get('/session', (request, response) => {
    const sessionUser = request.session?.user
    response.json({
      data: sessionUser?.username
        ? { authenticated: true, user: publicUser(sessionUser) }
        : { authenticated: false, user: null },
    })
  })

  router.post('/logout', requireAuthenticatedSession, async (request, response, next) => {
    try {
      await destroySession(request)
      clearSessionCookie(response)
      response.json({ data: { authenticated: false } })
    } catch (error) {
      next(error)
    }
  })

  return router
}
