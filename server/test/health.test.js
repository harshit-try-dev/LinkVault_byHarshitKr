import assert from 'node:assert/strict'
import test from 'node:test'
import { createHealthHandler } from '../src/app.js'

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
}

test('health returns 200 when MongoDB is connected', async () => {
  const response = createResponse()
  createHealthHandler(() => true)({}, response)

  assert.equal(response.statusCode, 200)
  assert.deepEqual(response.body, {
    service: 'linkvault-api',
    status: 'ok',
    database: 'connected',
  })
})

test('health returns 503 when MongoDB is unavailable', async () => {
  const response = createResponse()
  createHealthHandler(() => false)({}, response)

  assert.equal(response.statusCode, 503)
  assert.deepEqual(response.body, {
    service: 'linkvault-api',
    status: 'degraded',
    database: 'unavailable',
  })
})

