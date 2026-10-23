import mongoose from 'mongoose'
import { Click } from '../models/click.model.js'
import { Link } from '../models/link.model.js'
import { HttpError } from '../utils/http-error.js'
import { isExpired, isValidHttpUrl } from '../utils/validation.js'
import { generateShortCode } from '../utils/random.js'
import { DateRangeError, parseAnalyticsRange } from '../utils/date-range.js'

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 20
const MAX_PAGE = 1000000
const MAX_LIMIT = 100
const MAX_CREATE_ATTEMPTS = 5

function isDuplicateKeyError(error) {
  return error?.code === 11000
}

function parsePaginationValue(value, name, defaultValue, maximum) {
  if (value === undefined) {
    return defaultValue
  }

  if (Array.isArray(value) || !/^\d+$/.test(String(value))) {
    throw new HttpError(400, 'INVALID_PAGINATION', `${name} must be a positive integer.`)
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new HttpError(400, 'INVALID_PAGINATION', `${name} must be between 1 and ${maximum}.`)
  }

  return parsed
}

function parseOptionalExpiry(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(422, 'INVALID_EXPIRY', 'expiresAt must be a valid date.')
  }

  return parsed
}

function validateObjectId(id) {
  if (!mongoose.isObjectIdOrHexString(id)) {
    throw new HttpError(400, 'INVALID_ID', 'The link id is invalid.')
  }
}

function activeLinkFilter() {
  return { deletedAt: null }
}

function ownerFilter(ownerId) {
  if (ownerId === undefined) return {}

  validateObjectId(ownerId)
  return { ownerId: new mongoose.Types.ObjectId(ownerId) }
}

function serializeLink(link, clickCount = 0, shortUrl) {
  return {
    id: String(link._id),
    shortCode: link.shortCode,
    originalUrl: link.originalUrl,
    expiresAt: link.expiresAt,
    deletedAt: link.deletedAt,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
    clickCount,
    ...(shortUrl ? { shortUrl } : {}),
  }
}

function missingLinkError() {
  return new HttpError(404, 'LINK_NOT_FOUND', 'Link not found.')
}

function invalidStoredUrlError() {
  return new HttpError(500, 'INVALID_STORED_URL', 'The stored link destination is invalid.')
}

function clickPersistenceError() {
  return new HttpError(503, 'CLICK_PERSISTENCE_FAILED', 'The click could not be recorded. Please try again.')
}

export function createLinkService({
  LinkModel = Link,
  ClickModel = Click,
  codeGenerator = generateShortCode,
} = {}) {
  return {
    async createLink({ originalUrl, expiresAt, ownerId = null }) {
      if (!isValidHttpUrl(originalUrl)) {
        throw new HttpError(422, 'INVALID_URL', 'originalUrl must be a valid HTTP or HTTPS URL.')
      }

      if (ownerId !== null) validateObjectId(ownerId)

      const normalizedUrl = originalUrl.trim()
      const normalizedExpiry = parseOptionalExpiry(expiresAt)

      for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
        try {
          return await LinkModel.create({
            shortCode: codeGenerator(),
            originalUrl: normalizedUrl,
            expiresAt: normalizedExpiry,
            deletedAt: null,
            ownerId,
          })
        } catch (error) {
          if (!isDuplicateKeyError(error)) {
            throw error
          }
        }
      }

      throw new HttpError(
        503,
        'SHORT_CODE_UNAVAILABLE',
        'A unique short code could not be generated. Please try again.',
      )
    },

    async listLinks({ page, limit }, ownerId) {
      const currentPage = parsePaginationValue(page, 'page', DEFAULT_PAGE, MAX_PAGE)
      const pageLimit = parsePaginationValue(limit, 'limit', DEFAULT_LIMIT, MAX_LIMIT)
      const filter = { ...activeLinkFilter(), ...ownerFilter(ownerId) }
      const skip = (currentPage - 1) * pageLimit
      const [links, total] = await Promise.all([
        LinkModel.find(filter)
          .sort({ createdAt: -1, _id: -1 })
          .skip(skip)
          .limit(pageLimit)
          .lean(),
        LinkModel.countDocuments(filter),
      ])

      const clickCounts = new Map()
      if (links.length > 0) {
        const clickCountRows = await ClickModel.aggregate([
          { $match: { linkId: { $in: links.map((link) => link._id) } } },
          { $group: { _id: '$linkId', count: { $sum: 1 } } },
        ])
        for (const row of clickCountRows) {
          clickCounts.set(String(row._id), row.count)
        }
      }

      const items = links.map((link) => serializeLink(link, clickCounts.get(String(link._id)) || 0))

      return {
        items,
        pagination: {
          page: currentPage,
          limit: pageLimit,
          total,
          pages: total === 0 ? 0 : Math.ceil(total / pageLimit),
        },
      }
    },

    async getLink(id, ownerId) {
      validateObjectId(id)
      const link = await LinkModel.findOne({ _id: id, ...activeLinkFilter(), ...ownerFilter(ownerId) }).lean()
      if (!link) {
        throw missingLinkError()
      }

      const clickCount = await ClickModel.countDocuments({ linkId: link._id })
      return serializeLink(link, clickCount)
    },

    async deleteLink(id, ownerId) {
      validateObjectId(id)
      const link = await LinkModel.findOneAndUpdate(
        { _id: id, ...activeLinkFilter(), ...ownerFilter(ownerId) },
        { $set: { deletedAt: new Date() } },
        { new: true },
      ).lean()

      if (!link) {
        throw missingLinkError()
      }

      return serializeLink(link, await ClickModel.countDocuments({ linkId: link._id }))
    },

    async resolveRedirectableLink(shortCode) {
      const link = await LinkModel.findOne({ shortCode }).lean()
      if (!link || link.deletedAt) {
        throw missingLinkError()
      }

      if (isExpired(link.expiresAt)) {
        throw new HttpError(410, 'LINK_EXPIRED', 'This link has expired.')
      }

      if (!isValidHttpUrl(link.originalUrl)) {
        throw invalidStoredUrlError()
      }

      return link
    },

    async resolveRedirect(shortCode) {
      const link = await this.resolveRedirectableLink(shortCode)
      return link.originalUrl
    },

    async recordRedirectClick(shortCode) {
      const link = await this.resolveRedirectableLink(shortCode)

      try {
        await ClickModel.create({ linkId: link._id })
      } catch {
        throw clickPersistenceError()
      }

      return link.originalUrl
    },

    async getAnalytics(id, range, ownerId) {
      validateObjectId(id)
      const link = await LinkModel.findOne({ _id: id, ...activeLinkFilter(), ...ownerFilter(ownerId) }).lean()
      if (!link) {
        throw missingLinkError()
      }

      let parsedRange
      try {
        parsedRange = parseAnalyticsRange(range)
      } catch (error) {
        if (error instanceof DateRangeError) {
          throw new HttpError(400, 'INVALID_DATE_RANGE', error.message)
        }
        throw error
      }

      const [analytics] = await ClickModel.aggregate([
        {
          $match: {
            linkId: new mongoose.Types.ObjectId(id),
            clickedAt: {
              $gte: parsedRange.from,
              $lt: parsedRange.to,
            },
          },
        },
        {
          $facet: {
            total: [{ $count: 'count' }],
            byDate: [
              {
                $group: {
                  _id: {
                    $dateToString: {
                      format: '%Y-%m-%d',
                      date: '$clickedAt',
                      timezone: 'UTC',
                    },
                  },
                  clicks: { $sum: 1 },
                },
              },
              { $sort: { _id: 1 } },
            ],
          },
        },
      ])

      return {
        range: {
          from: parsedRange.from.toISOString(),
          to: parsedRange.to.toISOString(),
          boundary: 'from-inclusive-to-exclusive',
          timezone: 'UTC',
        },
        totalClicks: analytics?.total?.[0]?.count || 0,
        byDate: (analytics?.byDate || []).map((row) => ({
          date: row._id,
          clicks: row.clicks,
        })),
      }
    },
  }
}

