import assert from 'node:assert/strict'
import mongoose from 'mongoose'
import test from 'node:test'
import { createLinkService } from '../src/services/link.service.js'

const LINK_ID = '507f1f77bcf86cd799439011'
const OWNER_ID = '507f1f77bcf86cd799439012'

function linkDocument(overrides = {}) {
  return {
    _id: LINK_ID,
    shortCode: 'abc1234',
    originalUrl: 'https://example.com/target',
    expiresAt: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }
}

function query(value, capture = {}) {
  return {
    sort(sortValue) {
      capture.sort = sortValue
      return this
    },
    skip(skipValue) {
      capture.skip = skipValue
      return this
    },
    limit(limitValue) {
      capture.limit = limitValue
      return this
    },
    lean: async () => value,
  }
}

test('rejects an invalid URL before attempting creation', async () => {
  let createCalls = 0
  const service = createLinkService({
    LinkModel: {
      create: async () => {
        createCalls += 1
      },
    },
  })

  await assert.rejects(
    () => service.createLink({ originalUrl: 'javascript:alert(1)' }),
    (error) => error.status === 422 && error.code === 'INVALID_URL',
  )
  assert.equal(createCalls, 0)
})

test('retries a duplicate short-code collision and then succeeds', async () => {
  const generatedCodes = ['duplicate', 'unique01']
  let attempts = 0
  const service = createLinkService({
    codeGenerator: () => generatedCodes[attempts],
    LinkModel: {
      create: async (data) => {
        attempts += 1
        if (attempts === 1) {
          const error = new Error('duplicate key')
          error.code = 11000
          throw error
        }
        return linkDocument({ ...data, shortCode: generatedCodes[1] })
      },
    },
  })

  const link = await service.createLink({ originalUrl: 'https://example.com' })

  assert.equal(attempts, 2)
  assert.equal(link.shortCode, 'unique01')
})

test('stops after the bounded number of duplicate short-code retries', async () => {
  let attempts = 0
  const service = createLinkService({
    LinkModel: {
      create: async () => {
        attempts += 1
        const error = new Error('duplicate key')
        error.code = 11000
        throw error
      },
    },
  })

  await assert.rejects(
    () => service.createLink({ originalUrl: 'https://example.com' }),
    (error) => error.status === 503 && error.code === 'SHORT_CODE_UNAVAILABLE',
  )
  assert.equal(attempts, 5)
})

test('lists active links with bounded pagination and derived click totals', async () => {
  const capture = {}
  const activeLink = linkDocument({ _id: '507f1f77bcf86cd799439012' })
  const service = createLinkService({
    LinkModel: {
      find: (filter) => {
        capture.filter = filter
        return query([activeLink], capture)
      },
      countDocuments: async (filter) => {
        capture.countFilter = filter
        return 1
      },
    },
    ClickModel: {
      aggregate: async (pipeline) => {
        capture.clickPipeline = pipeline
        return [{ _id: activeLink._id, count: 3 }]
      },
    },
  })

  const result = await service.listLinks({ page: '2', limit: '10' })

  assert.deepEqual(capture.filter, { deletedAt: null })
  assert.deepEqual(capture.countFilter, { deletedAt: null })
  assert.deepEqual(capture.sort, { createdAt: -1, _id: -1 })
  assert.equal(capture.skip, 10)
  assert.equal(capture.limit, 10)
  assert.deepEqual(capture.clickPipeline[0], {
    $match: { linkId: { $in: [activeLink._id] } },
  })
  assert.equal(result.items[0].clickCount, 3)
  assert.deepEqual(result.pagination, { page: 2, limit: 10, total: 1, pages: 1 })
})

test('soft-deletes an active link without deleting click history', async () => {
  let clickDeleteCalls = 0
  let updateArguments
  const deletedAt = new Date('2026-01-02T00:00:00.000Z')
  const service = createLinkService({
    LinkModel: {
      findOneAndUpdate: (...args) => {
        updateArguments = args
        return query(linkDocument({ deletedAt }))
      },
    },
    ClickModel: {
      countDocuments: async () => 4,
      deleteMany: async () => {
        clickDeleteCalls += 1
      },
    },
  })

  const result = await service.deleteLink(LINK_ID)

  assert.deepEqual(updateArguments[0], { _id: LINK_ID, deletedAt: null })
  assert.equal(updateArguments[1].$set.deletedAt instanceof Date, true)
  assert.deepEqual(updateArguments[2], { new: true })
  assert.equal(result.deletedAt, deletedAt)
  assert.equal(result.clickCount, 4)
  assert.equal(clickDeleteCalls, 0)
})

test('rejects invalid ids and returns not-found for missing links', async () => {
  const service = createLinkService({
    LinkModel: {
      findOne: () => query(null),
    },
  })

  await assert.rejects(
    () => service.getLink('not-an-object-id'),
    (error) => error.status === 400 && error.code === 'INVALID_ID',
  )
  await assert.rejects(
    () => service.getLink(LINK_ID),
    (error) => error.status === 404 && error.code === 'LINK_NOT_FOUND',
  )
})

test('returns the stored destination for an active redirect', async () => {
  const service = createLinkService({
    LinkModel: {
      findOne: () => query(linkDocument()),
    },
  })

  assert.equal(await service.resolveRedirect('abc1234'), 'https://example.com/target')
})

test('returns 410 for expired redirects and 404 for deleted redirects', async () => {
  const expiredService = createLinkService({
    LinkModel: {
      findOne: () => query(linkDocument({ expiresAt: new Date('2025-01-01T00:00:00.000Z') })),
    },
  })
  const deletedService = createLinkService({
    LinkModel: {
      findOne: () => query(linkDocument({ deletedAt: new Date('2026-01-02T00:00:00.000Z') })),
    },
  })

  await assert.rejects(
    () => expiredService.resolveRedirect('abc1234'),
    (error) => error.status === 410 && error.code === 'LINK_EXPIRED',
  )
  await assert.rejects(
    () => deletedService.resolveRedirect('abc1234'),
    (error) => error.status === 404 && error.code === 'LINK_NOT_FOUND',
  )
})

test('user link queries include only the authenticated owner', async () => {
  const captures = {}
  const activeLink = linkDocument({ ownerId: OWNER_ID })
  const service = createLinkService({
    LinkModel: {
      find: (filter) => {
        captures.listFilter = filter
        return query([activeLink], captures)
      },
      countDocuments: async (filter) => {
        captures.countFilter = filter
        return 1
      },
      findOne: (filter) => {
        captures.oneFilter = filter
        return query(activeLink)
      },
    },
    ClickModel: {
      aggregate: async () => [],
      countDocuments: async () => 2,
    },
  })

  await service.listLinks({ page: '1', limit: '10' }, OWNER_ID)
  await service.getLink(String(activeLink._id), OWNER_ID)

  const expectedOwner = new mongoose.Types.ObjectId(OWNER_ID)
  assert.deepEqual(captures.listFilter, { deletedAt: null, ownerId: expectedOwner })
  assert.deepEqual(captures.countFilter, { deletedAt: null, ownerId: expectedOwner })
  assert.deepEqual(captures.oneFilter, { _id: String(activeLink._id), deletedAt: null, ownerId: expectedOwner })
})

test('list results remain isolated for two different owners', async () => {
  const aliceLink = linkDocument({ _id: '507f1f77bcf86cd799439014', ownerId: OWNER_ID, shortCode: 'alice01' })
  const bobLink = linkDocument({ _id: '507f1f77bcf86cd799439015', ownerId: '507f1f77bcf86cd799439013', shortCode: 'bob0001' })
  const service = createLinkService({
    LinkModel: {
      find: (filter) => query(filter.ownerId.equals(new mongoose.Types.ObjectId(OWNER_ID)) ? [aliceLink] : [bobLink]),
      countDocuments: async () => 1,
    },
    ClickModel: { aggregate: async () => [] },
  })

  const aliceResult = await service.listLinks({ page: '1', limit: '10' }, OWNER_ID)
  const bobResult = await service.listLinks({ page: '1', limit: '10' }, '507f1f77bcf86cd799439013')

  assert.deepEqual(aliceResult.items.map((link) => link.shortCode), ['alice01'])
  assert.deepEqual(bobResult.items.map((link) => link.shortCode), ['bob0001'])
})

test('a user cannot access another user link through detail, delete, or analytics', async () => {
  const ownerLink = linkDocument({ ownerId: OWNER_ID })
  let deleteFilter
  const service = createLinkService({
    LinkModel: {
      findOne: (filter) => query(filter.ownerId?.equals(new mongoose.Types.ObjectId(OWNER_ID)) ? ownerLink : null),
      findOneAndUpdate: (filter) => { deleteFilter = filter; return query(null) },
    },
    ClickModel: { countDocuments: async () => 0, aggregate: async () => [] },
  })

  await assert.rejects(() => service.getLink(String(ownerLink._id), '507f1f77bcf86cd799439013'), (error) => error.status === 404)
  await assert.rejects(() => service.deleteLink(String(ownerLink._id), '507f1f77bcf86cd799439013'), (error) => error.status === 404)
  await assert.rejects(() => service.getAnalytics(String(ownerLink._id), {}, '507f1f77bcf86cd799439013'), (error) => error.status === 404)

  const stillPresent = await service.getLink(String(ownerLink._id), OWNER_ID)
  assert.equal(stillPresent.id, String(ownerLink._id))
  assert.equal(deleteFilter.ownerId.equals(new mongoose.Types.ObjectId('507f1f77bcf86cd799439013')), true)
})

test('admin scope can still access legacy links without an owner', async () => {
  const legacyLink = linkDocument({ ownerId: null })
  let receivedFilter
  const service = createLinkService({
    LinkModel: {
      findOne: (filter) => {
        receivedFilter = filter
        return query(legacyLink)
      },
    },
    ClickModel: { countDocuments: async () => 3 },
  })

  const result = await service.getLink(String(legacyLink._id))

  assert.equal(result.clickCount, 3)
  assert.deepEqual(receivedFilter, { _id: String(legacyLink._id), deletedAt: null })
})

