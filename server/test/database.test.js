import assert from 'node:assert/strict'
import test from 'node:test'
import { DatabaseConnectionError } from '../src/database.js'

test('connection diagnostics preserve useful safe error details without credentials', () => {
  const cause = new Error('query failed for mongodb+srv://atlas-user:secret-pass@cluster.example/db?retryWrites=true')
  cause.name = 'MongoServerSelectionError'
  cause.code = 'ENOTFOUND'

  const wrapped = new DatabaseConnectionError(cause)

  assert.deepEqual(wrapped.diagnostics, {
    name: 'MongoServerSelectionError',
    code: 'ENOTFOUND',
    message: 'query failed for mongodb://[redacted]',
  })
  assert.equal(wrapped.diagnostics.message.includes('secret-pass'), false)
  assert.equal(wrapped.diagnostics.message.includes('atlas-user'), false)
})

test('connection diagnostics handle errors without a code or message', () => {
  const wrapped = new DatabaseConnectionError({ name: 'MongoNetworkError' })

  assert.deepEqual(wrapped.diagnostics, {
    name: 'MongoNetworkError',
    code: 'UNKNOWN',
    message: 'MongoDB connection failed.',
  })
})

test('connection diagnostics redact authentication usernames', () => {
  const cause = new Error('Authentication failed for user "atlas-user"')
  cause.name = 'MongoServerError'
  cause.code = 8000

  const wrapped = new DatabaseConnectionError(cause)

  assert.equal(wrapped.diagnostics.message, 'Authentication failed for user [redacted]')
  assert.equal(wrapped.diagnostics.message.includes('atlas-user'), false)
})
