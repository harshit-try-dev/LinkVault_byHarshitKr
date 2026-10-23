import assert from 'node:assert/strict'
import bcrypt from 'bcryptjs'
import test from 'node:test'
import { ConfigError, loadConfig } from '../src/config.js'

const baseEnv = {
  NODE_ENV: 'development',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/linkvault',
  PORT: '5000',
  CORS_ORIGIN: 'http://localhost:5173',
  ADMIN_USERNAME: 'admin',
  ADMIN_PASSWORD_HASH: bcrypt.hashSync('correct-password', 12),
  SESSION_SECRET: 'test-session-secret-test-session-secret',
}

test('loads a development session configuration', () => {
  const config = loadConfig(baseEnv)

  assert.equal(config.adminUsername, 'admin')
  assert.equal(config.productionLike, false)
  assert.equal(config.sessionTtlMs, 8 * 60 * 60 * 1000)
})

test('accepts a credential-free Atlas-style standard seed-list URI', () => {
  const uri = 'mongodb://ac-linkvault-a.example.mongodb.net:27017,ac-linkvault-b.example.mongodb.net:27017,ac-linkvault-c.example.mongodb.net:27017/linkvault?replicaSet=atlas-linkvault-shard-0&tls=true&authSource=admin&retryWrites=true&w=majority'
  const config = loadConfig({ ...baseEnv, MONGODB_URI: uri })

  assert.equal(config.mongoUri, uri)
})

test('accepts URL-encoded credentials in a MongoDB URI', () => {
  const uri = 'mongodb://atlas-user:encoded%40password%23value@db.example.mongodb.net:27017/linkvault?authSource=admin'
  const config = loadConfig({ ...baseEnv, MONGODB_URI: uri })

  assert.equal(config.mongoUri, uri)
})

test('rejects malformed MongoDB schemes and host lists', () => {
  assert.throws(() => loadConfig({ ...baseEnv, MONGODB_URI: 'https://db.example.mongodb.net/linkvault' }), ConfigError)
  assert.throws(() => loadConfig({ ...baseEnv, MONGODB_URI: 'mongodb://:27017/linkvault' }), ConfigError)
  assert.throws(() => loadConfig({ ...baseEnv, MONGODB_URI: 'mongodb://db-a.example, /linkvault' }), ConfigError)
})

test('defaults omitted NODE_ENV to production and requires explicit production CORS', () => {
  const environment = { ...baseEnv }
  delete environment.NODE_ENV
  delete environment.CORS_ORIGIN

  assert.throws(
    () => loadConfig(environment),
    (error) => error instanceof ConfigError && error.message.includes('CORS_ORIGIN is required'),
  )
})

test('the legacy unauthenticated bypass does not disable session configuration', () => {
  const config = loadConfig({ ...baseEnv, ALLOW_UNAUTHENTICATED_MANAGEMENT: 'true' })

  assert.equal(Object.hasOwn(config, 'allowUnauthenticatedManagement'), false)
})

test('weak session secrets fail validation', () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, SESSION_SECRET: 'too-short' }),
    (error) => error instanceof ConfigError && error.message.includes('SESSION_SECRET'),
  )
})

test('weak password hashes fail validation', () => {
  assert.throws(
    () => loadConfig({ ...baseEnv, ADMIN_PASSWORD_HASH: bcrypt.hashSync('correct-password', 10) }),
    (error) => error instanceof ConfigError && error.message.includes('bcrypt cost 12'),
  )
})

test('wildcard and path-bearing CORS origins fail validation', () => {
  assert.throws(() => loadConfig({ ...baseEnv, CORS_ORIGIN: '*' }), ConfigError)
  assert.throws(() => loadConfig({ ...baseEnv, CORS_ORIGIN: 'https://app.example/path' }), ConfigError)
})

test('production requires an explicit HTTPS frontend origin', () => {
  const productionEnv = { ...baseEnv, NODE_ENV: 'production', CORS_ORIGIN: 'https://app.example' }
  assert.equal(loadConfig(productionEnv).corsOrigin, 'https://app.example')
  assert.throws(
    () => loadConfig({ ...productionEnv, CORS_ORIGIN: 'http://app.example' }),
    (error) => error instanceof ConfigError && error.message.includes('HTTPS origin'),
  )
})
