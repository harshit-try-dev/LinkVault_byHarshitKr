import { Router } from 'express'
import {
  createLinkController,
  deleteLinkController,
  getLinkController,
  listLinksController,
  analyticsController,
} from '../controllers/link.controller.js'

export function createLinkRouter({ service } = {}) {
  const router = Router()

  router.post('/', createLinkController({ service }))
  router.get('/', listLinksController({ service }))
  router.get('/:id/analytics', analyticsController({ service }))
  router.get('/:id', getLinkController({ service }))
  router.delete('/:id', deleteLinkController({ service }))

  return router
}

