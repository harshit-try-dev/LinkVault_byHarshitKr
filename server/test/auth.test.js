import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import session from 'express-session'
import request from 'supertest'
import test from 'node:test'
import { createApp } from '../src/app.js'
import { createLoginRateLimiter } from '../src/auth.js'
import { ConfigError } from '../src/config.js'

const ORIGIN = 'http://localhost:5173'
const USERNAME = 'admin'
const PASSWORD = 'correct-password'
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 12)

function createUserModel(initialUsers = []) {
  const users = new Map(initialUsers.map((user) => [user.username, user]))
  let nextId = 1

  return {
    users,
    findOne(filter) {
      const user = users.get(filter.username) || null
      return { select: async () => user }
    },
    async create(data) {
      if (users.has(data.username)) {
        const error = new Error('duplicate username')
        error.code = 11000
        throw error
      }
      const user = { _id: `507f1f77bcf86cd7994390${String(nextId++).padStart(2, '0')}`, ...data }
      users.set(user.username, user)
      return user
    },
  }
}

class TestPersistentStore extends session.Store {
  constructor() {
    super()
    this.sessions = new Map()
  }

  get(id, callback) { callback(null, this.sessions.get(id) || null) }
  set(id, value, callback) { this.sessions.set(id, value); callback(null) }
  destroy(id, callback) { this.sessions.delete(id); callback(null) }
  touch(id, value, callback) { this.sessions.set(id, value); callback(null) }
}

function createTestApp(options = {}) {
  return createApp({
    nodeEnv: 'test',
    corsOrigin: ORIGIN,
    sessionSecret: 'test-session-secret-test-session-secret',
    sessionTtlMs: 60 * 60 * 1000,
    sessionStore: new session.MemoryStore(),
    adminUsername: USERNAME,
    adminPasswordHash: PASSWORD_HASH,
    userModel: createUserModel(),
    linkService: {
      async listLinks() {
        return { items: [], pagination: { page: 1, limit: 100, total: 0, pages: 0 } }
      },
      async recordRedirectClick() {
        return 'https://example.com/'
      },
      ...options.linkService,
    },
    ...options,
  })
}

async function getCsrf(agent, origin = ORIGIN) {
  const response = await agent.get('/api/auth/csrf-token').set('Origin', origin)
  assert.equal(response.status, 200)
  return response.body.data.csrfToken
}

function cookieFromResponse(response) {
  const cookie = response.headers['set-cookie']?.find((value) => value.startsWith('linkvault.sid='))
  return cookie?.split(';', 1)[0]
}

async function login(agent, csrfToken) {
  if (!csrfToken) csrfToken = await getCsrf(agent)

  return agent
    .post('/api/auth/login')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrfToken)
    .send({ username: USERNAME, password: PASSWORD })
}

async function loginUser(agent, username) {
  const csrfToken = await getCsrf(agent)
  return agent
    .post('/api/auth/login')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrfToken)
    .send({ username, password: 'long-enough-password' })
}

test('valid login creates a session and regenerates the session id', async () => {
  const agent = request.agent(createTestApp())
  const csrfResponse = await agent.get('/api/auth/csrf-token').set('Origin', ORIGIN)
  const response = await login(agent, csrfResponse.body.data.csrfToken)
  const beforeLoginCookie = cookieFromResponse(csrfResponse)
  const afterLoginCookie = cookieFromResponse(response)

  assert.equal(response.status, 200)
  assert.deepEqual(response.body.data, { authenticated: true, user: { username: USERNAME, role: 'admin' } })
  assert.ok(beforeLoginCookie)
  assert.ok(afterLoginCookie)
  assert.notEqual(beforeLoginCookie, afterLoginCookie)
})

test('invalid credentials return one generic authentication error', async () => {
  const agent = request.agent(createTestApp())
  const csrfToken = await getCsrf(agent)
  const response = await agent
    .post('/api/auth/login')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrfToken)
    .send({ username: 'wrong', password: 'wrong' })

  assert.equal(response.status, 401)
  assert.deepEqual(response.body.error, {
    code: 'AUTHENTICATION_FAILED',
    message: 'Invalid username or password.',
  })
})

test('registration requires CSRF, creates a bcrypt user, and rejects duplicates', async () => {
  const userModel = createUserModel()
  const app = createTestApp({ userModel })
  const agent = request.agent(app)
  const missingToken = await agent
    .post('/api/auth/register')
    .set('Origin', ORIGIN)
    .send({ username: 'alice', password: 'long-enough-password' })
  const csrfToken = await getCsrf(agent)
  const registered = await agent
    .post('/api/auth/register')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrfToken)
    .send({ username: 'Alice', password: 'long-enough-password' })
  const duplicate = await agent
    .post('/api/auth/register')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrfToken)
    .send({ username: 'alice', password: 'another-long-password' })

  assert.equal(missingToken.status, 403)
  assert.equal(registered.status, 201)
  assert.deepEqual(registered.body.data.user, { username: 'alice', role: 'user' })
  assert.equal(bcrypt.getRounds(userModel.users.get('alice').passwordHash), 12)
  assert.equal(duplicate.status, 409)
})

test('registration rejects the reserved admin username and weak passwords', async () => {
  const app = createTestApp()
  const agent = request.agent(app)
  const csrfToken = await getCsrf(agent)
  const reserved = await agent
    .post('/api/auth/register')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrfToken)
    .send({ username: 'Admin', password: 'long-enough-password' })
  const weak = await agent
    .post('/api/auth/register')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrfToken)
    .send({ username: 'charlie', password: 'short' })

  assert.equal(reserved.status, 409)
  assert.equal(weak.status, 422)
})

test('ordinary users can log in and receive a user session without admin access', async () => {
  const userModel = createUserModel([{
    _id: '507f1f77bcf86cd799439011',
    username: 'alice',
    passwordHash: bcrypt.hashSync('long-enough-password', 12),
  }])
  const app = createTestApp({ userModel })
  const agent = request.agent(app)
  const csrfToken = await getCsrf(agent)
  const response = await agent
    .post('/api/auth/login')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrfToken)
    .send({ username: 'alice', password: 'long-enough-password' })
  const session = await agent.get('/api/auth/session').set('Origin', ORIGIN)

  assert.equal(response.status, 200)
  assert.deepEqual(response.body.data.user, { username: 'alice', role: 'user' })
  assert.deepEqual(session.body.data.user, { username: 'alice', role: 'user' })
})

test('two ordinary users receive separate owner scopes from management routes', async () => {
  const ownerA = '507f1f77bcf86cd799439011'
  const ownerB = '507f1f77bcf86cd799439012'
  const userModel = createUserModel([
    { _id: ownerA, username: 'alice', passwordHash: bcrypt.hashSync('long-enough-password', 12) },
    { _id: ownerB, username: 'bob', passwordHash: bcrypt.hashSync('long-enough-password', 12) },
  ])
  const ownersSeen = []
  const app = createTestApp({
    userModel,
    linkService: {
      async listLinks(_query, ownerId) {
        ownersSeen.push(ownerId)
        return { items: [], pagination: { page: 1, limit: 100, total: 0, pages: 0 } }
      },
    },
  })
  const alice = request.agent(app)
  const bob = request.agent(app)

  await getCsrf(alice)
  await loginUser(alice, 'alice')
  await getCsrf(bob)
  await loginUser(bob, 'bob')
  assert.equal((await alice.get('/api/links').set('Origin', ORIGIN)).status, 200)
  assert.equal((await bob.get('/api/links').set('Origin', ORIGIN)).status, 200)

  assert.deepEqual(ownersSeen, [ownerA, ownerB])
})

test('ordinary users cannot override link ownership in the request body', async () => {
  const ownerId = '507f1f77bcf86cd799439011'
  const otherOwnerId = '507f1f77bcf86cd799439012'
  let createPayload
  const app = createTestApp({
    userModel: createUserModel([{
      _id: ownerId,
      username: 'alice',
      passwordHash: bcrypt.hashSync('long-enough-password', 12),
    }]),
    linkService: {
      async createLink(payload) {
        createPayload = payload
        return {
          _id: '507f1f77bcf86cd799439013',
          shortCode: 'alice01',
          originalUrl: payload.originalUrl,
          expiresAt: null,
          deletedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      },
    },
  })
  const agent = request.agent(app)
  await loginUser(agent, 'alice')
  const csrfToken = await getCsrf(agent)
  const response = await agent
    .post('/api/links')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrfToken)
    .send({ originalUrl: 'https://example.com/owned', ownerId: otherOwnerId })

  assert.equal(response.status, 201)
  assert.equal(createPayload.ownerId, ownerId)
  assert.notEqual(createPayload.ownerId, otherOwnerId)
})

test('missing and invalid sessions cannot access management APIs', async () => {
  const app = createTestApp()
  const missing = await request(app).get('/api/links').set('Origin', ORIGIN)
  const invalid = await request(app).get('/api/links').set('Origin', ORIGIN).set('Cookie', 'linkvault.sid=invalid')

  assert.equal(missing.status, 401)
  assert.equal(invalid.status, 401)
})

test('a valid session can access management APIs', async () => {
  const agent = request.agent(createTestApp())
  await login(agent)
  const response = await agent.get('/api/links').set('Origin', ORIGIN)

  assert.equal(response.status, 200)
  assert.deepEqual(response.body.data.items, [])
})

test('logout invalidates the session server-side', async () => {
  const agent = request.agent(createTestApp())
  const loginResponse = await login(agent)
  const csrfToken = await getCsrf(agent)
  const cookie = cookieFromResponse(loginResponse)
  const logoutResponse = await agent
    .post('/api/auth/logout')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrfToken)

  const reused = await request(createTestApp()).get('/api/links').set('Origin', ORIGIN).set('Cookie', cookie)

  assert.equal(logoutResponse.status, 200)
  assert.equal(reused.status, 401)
})

test('expired sessions are rejected', async () => {
  const agent = request.agent(createTestApp({ sessionTtlMs: 10 }))
  await login(agent)
  await new Promise((resolve) => setTimeout(resolve, 30))
  const response = await agent.get('/api/links').set('Origin', ORIGIN)

  assert.equal(response.status, 401)
})

test('production app construction fails without a persistent session store', () => {
  for (const sessionStore of [undefined, new session.MemoryStore()]) {
    assert.throws(
      () => createTestApp({ nodeEnv: 'production', sessionStore }),
      (error) => error instanceof ConfigError && error.message.includes('persistent MongoDB session store'),
    )
  }
})

test('production session cookies include secure HttpOnly and SameSite flags', async () => {
  const app = createTestApp({
    nodeEnv: 'production',
    corsOrigin: 'https://app.example',
    secureCookies: true,
    sessionStore: new TestPersistentStore(),
  })
  const response = await request(app)
    .get('/api/auth/csrf-token')
    .set('Origin', 'https://app.example')
    .set('X-Forwarded-Proto', 'https')

  const cookie = response.headers['set-cookie']?.find((value) => value.startsWith('linkvault.sid='))
  assert.equal(response.status, 200)
  assert.match(cookie, /HttpOnly/)
  assert.match(cookie, /Secure/)
  assert.match(cookie, /SameSite=Lax/)
})

test('CSRF tokens are required and valid tokens permit login', async () => {
  const missing = await request(createTestApp()).post('/api/auth/login').set('Origin', ORIGIN).send({ username: USERNAME, password: PASSWORD })
  const agent = request.agent(createTestApp())
  const invalidToken = await agent
    .post('/api/auth/login')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', 'invalid')
    .send({ username: USERNAME, password: PASSWORD })
  const validToken = await login(agent)

  assert.equal(missing.status, 403)
  assert.equal(invalidToken.status, 403)
  assert.equal(validToken.status, 200)
})

test('unexpected origins are rejected and trusted preflight is credentialed', async () => {
  const app = createTestApp()
  const rejected = await request(app).options('/api/auth/login')
    .set('Origin', 'https://unexpected.example')
    .set('Access-Control-Request-Method', 'POST')
  const trusted = await request(app).options('/api/auth/login')
    .set('Origin', ORIGIN)
    .set('Access-Control-Request-Method', 'POST')

  assert.equal(rejected.status, 403)
  assert.equal(trusted.status, 204)
  assert.equal(trusted.headers['access-control-allow-origin'], ORIGIN)
  assert.equal(trusted.headers['access-control-allow-credentials'], 'true')
})

test('failed login attempts are rate limited', async () => {
  const agent = request.agent(createTestApp({ loginRateLimiter: createLoginRateLimiter({ maxFailures: 2 }) }))
  const csrfToken = await getCsrf(agent)
  const failedLogin = () => agent
    .post('/api/auth/login')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', csrfToken)
    .send({ username: USERNAME, password: 'wrong-password' })

  assert.equal((await failedLogin()).status, 401)
  assert.equal((await failedLogin()).status, 401)
  assert.equal((await failedLogin()).status, 429)
})

test('public redirects remain available without a dashboard session', async () => {
  const response = await request(createTestApp()).get('/public-code')

  assert.equal(response.status, 302)
  assert.equal(response.headers.location, 'https://example.com/')
})
