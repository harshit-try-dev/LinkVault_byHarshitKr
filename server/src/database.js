import mongoose from 'mongoose'
import { getErrorDiagnostics } from './utils/error-diagnostics.js'

const CONNECTION_TIMEOUT_MS = 5000

export class DatabaseConnectionError extends Error {
  constructor(cause) {
    super('MongoDB connection failed.')
    this.name = 'DatabaseConnectionError'
    this.diagnostics = getErrorDiagnostics(cause, 'MongoDB connection failed.')
  }
}

export async function connectDatabase(mongoUri) {
  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: CONNECTION_TIMEOUT_MS,
    })
  } catch (error) {
    try {
      await disconnectDatabase()
    } catch {
      // Preserve the original driver error if cleanup also fails.
    }
    throw new DatabaseConnectionError(error)
  }
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect()
  }
}

export function isDatabaseConnected() {
  return mongoose.connection.readyState === 1
}

