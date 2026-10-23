import assert from 'node:assert/strict'
import test from 'node:test'
import { configureDns, WINDOWS_DNS_SERVERS } from '../src/dns-config.js'

test('configures public DNS servers on Windows', () => {
  const configured = []

  configureDns({
    platform: 'win32',
    setServers: (servers) => configured.push(servers),
  })

  assert.deepEqual(configured, [WINDOWS_DNS_SERVERS])
})

test('does not override DNS servers on non-Windows platforms', () => {
  let callCount = 0

  configureDns({
    platform: 'linux',
    setServers: () => { callCount += 1 },
  })

  assert.equal(callCount, 0)
})
