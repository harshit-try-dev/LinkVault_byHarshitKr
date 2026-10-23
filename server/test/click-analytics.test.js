import assert from 'node:assert/strict'
import test from 'node:test'
import { redirectController } from '../src/controllers/link.controller.js'
import { createLinkService } from '../src/services/link.service.js'

const LINK_ID = '507f1f77bcf86cd799439011'

function linkDocument(overrides = {}) {
  return {
    _id: LINK_ID,
    shortCode: 'abc1234',
    originalUrl: 'https://example.com/target',
    expiresAt: null,
    deletedAt: null,
    ...overrides,
  }
}

function query(value) {
  return {
    lean: async () => value,
  }
}

test('records exactly one click before returning an active redirect destination', async () => {
  const clickEvents = []
  const service = createLinkService({
    LinkModel: { findOne: () => query(linkDocument()) },
    ClickModel: {
      create: async (event) => {
        clickEvents.push(event)
      },
    },
  })

  const destination = await service.recordRedirectClick('abc1234')

  assert.equal(destination, 'https://example.com/target')
  assert.equal(clickEvents.length, 1)
  assert.deepEqual(clickEvents[0], { linkId: LINK_ID })
})

test('does not redirect when click persistence fails', async () => {
  let redirectCalls = 0
  let nextError
  const controller = redirectController({
    service: {
      recordRedirectClick: async () => {
        const error = new Error('persistence failure')
        error.status = 503
        throw error
      },
    },
  })

  await controller(
    { params: { shortCode: 'abc1234' } },
    { redirect: () => { redirectCalls += 1 } },
    (error) => { nextError = error },
  )

  assert.equal(redirectCalls, 0)
  assert.equal(nextError.status, 503)
})

test('does not create clicks for missing, deleted, expired, or invalid links', async () => {
  const cases = [
    { name: 'missing', link: null, status: 404, code: 'LINK_NOT_FOUND' },
    {
      name: 'deleted',
      link: linkDocument({ deletedAt: new Date('2026-01-01T00:00:00.000Z') }),
      status: 404,
      code: 'LINK_NOT_FOUND',
    },
    {
      name: 'expired',
      link: linkDocument({ expiresAt: new Date('2025-01-01T00:00:00.000Z') }),
      status: 410,
      code: 'LINK_EXPIRED',
    },
    { name: 'invalid destination', link: linkDocument({ originalUrl: 'javascript:alert(1)' }), status: 500, code: 'INVALID_STORED_URL' },
  ]

  for (const testCase of cases) {
    let clickCreates = 0
    const service = createLinkService({
      LinkModel: { findOne: () => query(testCase.link) },
      ClickModel: {
        create: async () => {
          clickCreates += 1
        },
      },
    })

    await assert.rejects(
      () => service.recordRedirectClick('abc1234'),
      (error) => error.status === testCase.status && error.code === testCase.code,
      testCase.name,
    )
    assert.equal(clickCreates, 0, testCase.name)
  }
})

test('aggregates analytics by UTC date within an inclusive/exclusive range', async () => {
  let pipeline
  const service = createLinkService({
    LinkModel: { findOne: () => query(linkDocument()) },
    ClickModel: {
      aggregate: async (value) => {
        pipeline = value
        return [{
          total: [{ count: 3 }],
          byDate: [
            { _id: '2026-01-01', clicks: 2 },
            { _id: '2026-01-02', clicks: 1 },
          ],
        }]
      },
    },
  })

  const analytics = await service.getAnalytics(LINK_ID, {
    from: '2026-01-01T00:00:00.000Z',
    to: '2026-01-03T00:00:00.000Z',
  })

  assert.equal(analytics.totalClicks, 3)
  assert.deepEqual(analytics.byDate, [
    { date: '2026-01-01', clicks: 2 },
    { date: '2026-01-02', clicks: 1 },
  ])
  assert.equal(analytics.range.boundary, 'from-inclusive-to-exclusive')
  assert.equal(analytics.range.timezone, 'UTC')
  assert.equal(String(pipeline[0].$match.linkId), LINK_ID)
  assert.deepEqual(pipeline[0].$match.clickedAt, {
    $gte: new Date('2026-01-01T00:00:00.000Z'),
    $lt: new Date('2026-01-03T00:00:00.000Z'),
  })
})

test('returns empty analytics without fabricating click data', async () => {
  const service = createLinkService({
    LinkModel: { findOne: () => query(linkDocument()) },
    ClickModel: {
      aggregate: async () => [{ total: [], byDate: [] }],
    },
  })

  const analytics = await service.getAnalytics(LINK_ID, {
    from: '2026-02-01T00:00:00.000Z',
    to: '2026-02-02T00:00:00.000Z',
  })

  assert.equal(analytics.totalClicks, 0)
  assert.deepEqual(analytics.byDate, [])
})

test('rejects invalid ids, malformed dates, reversed ranges, and missing links', async () => {
  const service = createLinkService({
    LinkModel: { findOne: () => query(linkDocument()) },
    ClickModel: { aggregate: async () => [{ total: [], byDate: [] }] },
  })

  await assert.rejects(
    () => service.getAnalytics('invalid-id', {}),
    (error) => error.status === 400 && error.code === 'INVALID_ID',
  )
  await assert.rejects(
    () => service.getAnalytics(LINK_ID, { from: 'not-a-date' }),
    (error) => error.status === 400 && error.code === 'INVALID_DATE_RANGE',
  )
  await assert.rejects(
    () => service.getAnalytics(LINK_ID, {
      from: '2026-02-02T00:00:00.000Z',
      to: '2026-02-01T00:00:00.000Z',
    }),
    (error) => error.status === 400 && error.code === 'INVALID_DATE_RANGE',
  )

  const missingService = createLinkService({
    LinkModel: { findOne: () => query(null) },
    ClickModel: { aggregate: async () => { throw new Error('must not aggregate') } },
  })
  await assert.rejects(
    () => missingService.getAnalytics(LINK_ID, {}),
    (error) => error.status === 404 && error.code === 'LINK_NOT_FOUND',
  )
})

