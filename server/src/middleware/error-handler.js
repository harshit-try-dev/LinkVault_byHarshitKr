import { HttpError } from '../utils/http-error.js'

export function notFoundHandler(_request, response) {
  response.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found.',
    },
  })
}

export function errorHandler(error, _request, response, _next) {
  if (error instanceof HttpError) {
    return response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
      },
    })
  }

  if (error?.type === 'entity.parse.failed') {
    return response.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Request body must contain valid JSON.',
      },
    })
  }

  if (error?.name === 'ValidationError') {
    return response.status(422).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'The request could not be validated.',
      },
    })
  }

  if (error?.code === 11000) {
    return response.status(409).json({
      error: {
        code: 'CONFLICT',
        message: 'The requested resource conflicts with an existing record.',
      },
    })
  }

  return response.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected server error occurred.',
    },
  })
}

