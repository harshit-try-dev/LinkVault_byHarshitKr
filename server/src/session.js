import session from 'express-session'
import MongoStore from 'connect-mongo'
import mongoose from 'mongoose'
import { ConfigError } from './config.js'

export const SESSION_COOKIE_NAME = 'linkvault.sid'
export const SESSION_COLLECTION_NAME = 'sessions'

export function createMongoSessionStore({ sessionTtlMs } = {}) {
  if (mongoose.connection.readyState !== 1) {
    throw new ConfigError('MongoDB must be connected before creating the session store.')
  }

  return MongoStore.create({
    clientPromise: Promise.resolve(mongoose.connection.getClient()),
    collectionName: SESSION_COLLECTION_NAME,
    ttl: Math.floor(sessionTtlMs / 1000),
  })
}

export function createSessionMiddleware({
  nodeEnv,
  sessionSecret,
  sessionTtlMs,
  secureCookies,
  sessionStore,
} = {}) {
  if (nodeEnv !== 'test' && (!sessionStore || sessionStore instanceof session.MemoryStore)) {
    throw new ConfigError('A persistent MongoDB session store is required outside tests.')
  }

  return session({
    name: SESSION_COOKIE_NAME,
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      secure: Boolean(secureCookies),
      sameSite: 'none',
      maxAge: sessionTtlMs,
    },
  })
}
