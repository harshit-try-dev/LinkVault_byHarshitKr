import { createLinkService } from '../services/link.service.js'

function shortUrlFor(request, shortCode) {
  return `${request.protocol}://${request.get('host')}/${encodeURIComponent(shortCode)}`
}

function ownerIdFor(request) {
  return request.session?.user?.role === 'user' ? request.session.user.userId : undefined
}

export function createLinkController({ service = createLinkService() } = {}) {
  return async (request, response, next) => {
    try {
      const link = await service.createLink({ ...(request.body || {}), ownerId: ownerIdFor(request) })
      response.status(201).json({
        data: {
          id: String(link._id),
          shortCode: link.shortCode,
          originalUrl: link.originalUrl,
          expiresAt: link.expiresAt,
          deletedAt: link.deletedAt,
          createdAt: link.createdAt,
          updatedAt: link.updatedAt,
          shortUrl: shortUrlFor(request, link.shortCode),
          clickCount: 0,
        },
      })
    } catch (error) {
      next(error)
    }
  }
}

export function listLinksController({ service = createLinkService() } = {}) {
  return async (request, response, next) => {
    try {
      const result = await service.listLinks(request.query, ownerIdFor(request))
      response.json({ data: result })
    } catch (error) {
      next(error)
    }
  }
}

export function getLinkController({ service = createLinkService() } = {}) {
  return async (request, response, next) => {
    try {
      const link = await service.getLink(request.params.id, ownerIdFor(request))
      response.json({ data: link })
    } catch (error) {
      next(error)
    }
  }
}

export function deleteLinkController({ service = createLinkService() } = {}) {
  return async (request, response, next) => {
    try {
      const link = await service.deleteLink(request.params.id, ownerIdFor(request))
      response.json({ data: link })
    } catch (error) {
      next(error)
    }
  }
}

export function redirectController({ service = createLinkService() } = {}) {
  return async (request, response, next) => {
    try {
      const destination = await service.recordRedirectClick(request.params.shortCode)
      response.redirect(302, destination)
    } catch (error) {
      next(error)
    }
  }
}

export function analyticsController({ service = createLinkService() } = {}) {
  return async (request, response, next) => {
    try {
      const analytics = await service.getAnalytics(request.params.id, request.query, ownerIdFor(request))
      response.json({ data: analytics })
    } catch (error) {
      next(error)
    }
  }
}

