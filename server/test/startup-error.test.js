import assert from 'node:assert/strict'
import test from 'node:test'
import { unexpectedStartupErrorMessage } from '../src/utils/startup-error.js'

test('unexpected startup errors include safe diagnostic details', () => {
  const error = new Error('listen EADDRINUSE: password=do-not-log')
  error.name = 'Error'
  error.code = 'EADDRINUSE'

  assert.equal(
    unexpectedStartupErrorMessage(error),
    '[startup] Server could not start. name=Error code=EADDRINUSE message=listen EADDRINUSE: [redacted]',
  )
})

test('unexpected startup errors redact MongoDB connection strings', () => {
  const error = new Error('failed mongodb+srv://username:password@cluster.example/db')
  error.name = 'MongoError'
  error.code = 'MONGO_INIT'

  const message = unexpectedStartupErrorMessage(error)

  assert.equal(message.includes('username'), false)
  assert.equal(message.includes('password'), false)
  assert.equal(message.includes('cluster.example'), false)
})

test('unexpected startup errors redact bearer and management tokens', () => {
  const error = new Error('authorization: Bearer super-secret management_token=also-secret')

  const message = unexpectedStartupErrorMessage(error)

  assert.equal(message.includes('super-secret'), false)
  assert.equal(message.includes('also-secret'), false)
})
