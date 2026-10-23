import { createApp } from './app.js'
import { ConfigError, loadConfig } from './config.js'
import {
  connectDatabase,
  DatabaseConnectionError,
  disconnectDatabase,
} from './database.js'
import { createMongoSessionStore } from './session.js'
import { unexpectedStartupErrorMessage } from './utils/startup-error.js'

let httpServer
let shuttingDown = false

function startupErrorMessage(error) {
  if (error instanceof ConfigError) {
    return `[startup] Configuration error: ${error.message}`
  }

  if (error instanceof DatabaseConnectionError) {
    const { name, code, message } = error.diagnostics
    return `[startup] MongoDB connection failed. name=${name} code=${code} message=${message}`
  }

  return unexpectedStartupErrorMessage(error)
}

function listen(app, port) {
  return new Promise((resolve, reject) => {
    const server = app.listen(port)
    server.once('listening', () => resolve(server))
    server.once('error', reject)
  })
}

export async function startServer() {
  try {
    const config = loadConfig()
    await connectDatabase(config.mongoUri)
    const sessionStore = createMongoSessionStore({ sessionTtlMs: config.sessionTtlMs })

    const app = createApp({
      corsOrigin: config.corsOrigin,
      nodeEnv: config.nodeEnv,
      sessionSecret: config.sessionSecret,
      sessionTtlMs: config.sessionTtlMs,
      secureCookies: config.productionLike,
      sessionStore,
      adminUsername: config.adminUsername,
      adminPasswordHash: config.adminPasswordHash,
    })
    httpServer = await listen(app, config.port)

    console.log(`LinkVault API listening on port ${config.port}`)
  } catch (error) {
    console.error(startupErrorMessage(error))
    await disconnectDatabase()
    process.exitCode = 1
  }
}

async function shutdown(signal) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true

  if (httpServer) {
    await new Promise((resolve) => httpServer.close(resolve))
  }

  await disconnectDatabase()
  console.log(`[shutdown] Received ${signal}; server stopped.`)
}

process.once('SIGINT', () => {
  void shutdown('SIGINT')
})

process.once('SIGTERM', () => {
  void shutdown('SIGTERM')
})

void startServer()

