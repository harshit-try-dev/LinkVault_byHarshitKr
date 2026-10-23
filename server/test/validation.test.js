import assert from 'node:assert/strict'
import test from 'node:test'
import { isExpired, isValidHttpUrl } from '../src/utils/validation.js'
import { isValidUserPassword, normalizeUsername } from '../src/utils/user-validation.js'

test('accepts valid HTTP and HTTPS URLs', () => {
  assert.equal(isValidHttpUrl('http://example.com/path'), true)
  assert.equal(isValidHttpUrl('https://sub.example.com:8443/path?query=1'), true)
})

test('rejects malformed, unsafe, and credential-bearing URLs', () => {
  assert.equal(isValidHttpUrl('javascript:alert(1)'), false)
  assert.equal(isValidHttpUrl('ftp://example.com/file'), false)
  assert.equal(isValidHttpUrl('https://'), false)
  assert.equal(isValidHttpUrl('https://user:password@example.com'), false)
  assert.equal(isValidHttpUrl('not a URL'), false)
})

test('treats null and future expiry values as active', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')

  assert.equal(isExpired(null, now), false)
  assert.equal(isExpired(new Date('2026-01-01T00:00:01.000Z'), now), false)
})

test('treats expiry at or before now as expired', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')

  assert.equal(isExpired(new Date('2025-12-31T23:59:59.000Z'), now), true)
  assert.equal(isExpired(new Date('2026-01-01T00:00:00.000Z'), now), true)
})

test('normalizes and validates ordinary-user credentials', () => {
  assert.equal(normalizeUsername(' Alice_01 '), 'alice_01')
  assert.equal(normalizeUsername('ab'), null)
  assert.equal(normalizeUsername('bad name'), null)
  assert.equal(isValidUserPassword('long-enough-password'), true)
  assert.equal(isValidUserPassword('too-short'), false)
})

