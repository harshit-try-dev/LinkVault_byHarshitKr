import cors from 'cors'
import express from 'express'
import { createAuthRouter, requireAuthenticatedSession } from './auth.js'
import { isDatabaseConnected } from './database.js'
import { createOriginProtection, csrfProtection } from './middleware/csrf.js'
import { errorHandler, notFoundHandler } from './middleware/error-handler.js'
import { redirectController } from './controllers/link.controller.js'
import { User } from './models/user.model.js'
import { createLinkRouter } from './routes/link.routes.js'
import { createLinkService } from './services/link.service.js'
import { createSessionMiddleware, SESSION_COOKIE_NAME } from './session.js'

export function createHealthHandler(getDatabaseStatus = isDatabaseConnected) {
  return (_request, response) => {
    const connected = getDatabaseStatus()

    response.status(connected ? 200 : 503).json({
      service: 'linkvault-api',
      status: connected ? 'ok' : 'degraded',
      database: connected ? 'connected' : 'unavailable',
    })
  }
}

export function createApp({
  corsOrigin,
  getDatabaseStatus = isDatabaseConnected,
  linkService = createLinkService(),
  nodeEnv = 'test',
  sessionSecret = 'test-session-secret-test-session-secret',
  sessionTtlMs = 8 * 60 * 60 * 1000,
  secureCookies = false,
  sessionStore,
  adminUsername,
  adminPasswordHash,
  userModel = User,
  loginRateLimiter,
  registrationRateLimiter,
} = {}) {
  const app = express()
  const sessionMiddleware = createSessionMiddleware({
    nodeEnv,
    sessionSecret,
    sessionTtlMs,
    secureCookies,
    sessionStore,
  })

  if (secureCookies) app.set('trust proxy', 1)
  const trustedOrigin = corsOrigin || 'http://localhost:5173'
  app.use('/api', createOriginProtection(trustedOrigin))
  app.use('/api', cors({
    origin: trustedOrigin,
    credentials: true,
    allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  }))
  app.use(express.json({ limit: '16kb' }))
  app.use(sessionMiddleware)
  app.use('/api', csrfProtection)

  app.get('/api/health', createHealthHandler(getDatabaseStatus))
  app.use('/api/auth', createAuthRouter({
    adminUsername,
    adminPasswordHash,
    UserModel: userModel,
    loginRateLimiter,
    registrationRateLimiter,
    clearSessionCookie(response) {
      response.clearCookie(SESSION_COOKIE_NAME, {
        httpOnly: true,
        secure: Boolean(secureCookies),
        sameSite: 'none',
      })
    },
  }))
  app.use('/api/links', requireAuthenticatedSession, createLinkRouter({ service: linkService }))
  app.get('/:shortCode', redirectController({ service: linkService }))
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

