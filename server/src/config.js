import 'dotenv/config'
import bcrypt from 'bcryptjs'

const DEFAULT_PORT = 5000
const DEFAULT_CORS_ORIGIN = 'http://localhost:5173'
const DEFAULT_SESSION_TTL_HOURS = 8
const MIN_SESSION_SECRET_LENGTH = 32
const MIN_BCRYPT_ROUNDS = 12

export class ConfigError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConfigError'
  }
}

function requireString(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(`${name} is required.`)
  }

  return value.trim()
}

function validateMongoHost(hostPort) {
  if (!hostPort || /[\s/?#@]/.test(hostPort)) {
    throw new ConfigError('MONGODB_URI must include valid MongoDB host names.')
  }

  if (hostPort.startsWith('[')) {
    const closingBracket = hostPort.indexOf(']')
    if (closingBracket < 0 || (hostPort.length > closingBracket + 1 && !/^:\d+$/.test(hostPort.slice(closingBracket + 1)))) {
      throw new ConfigError('MONGODB_URI must include valid MongoDB host names and ports.')
    }
  } else if (hostPort.includes(':') && !/^.+:\d+$/.test(hostPort)) {
    throw new ConfigError('MONGODB_URI must include valid MongoDB host names and ports.')
  }

  try {
    const parsed = new URL('mongodb://' + hostPort + '/')
    if (!parsed.hostname) throw new Error('Missing host')
  } catch {
    throw new ConfigError('MONGODB_URI must include valid MongoDB host names and ports.')
  }
}

function validateMongoUri(value) {
  const normalized = requireString(value, 'MONGODB_URI')
  const match = /^(mongodb(?:\+srv)?):\/\/(.*)$/i.exec(normalized)

  if (!match) {
    throw new ConfigError('MONGODB_URI must use mongodb:// or mongodb+srv:// and include a host.')
  }

  const protocol = match[1].toLowerCase() + ':'
  const remainder = match[2]
  if (!remainder || /[#\s]/.test(remainder)) {
    throw new ConfigError('MONGODB_URI must be a valid MongoDB connection string.')
  }

  const authorityEnd = remainder.search(/[/?]/)
  const authority = authorityEnd < 0 ? remainder : remainder.slice(0, authorityEnd)
  const suffix = authorityEnd < 0 ? '' : remainder.slice(authorityEnd)
  const atIndex = authority.lastIndexOf('@')
  const userInfo = atIndex < 0 ? '' : authority.slice(0, atIndex)
  const hostList = atIndex < 0 ? authority : authority.slice(atIndex + 1)

  if (!hostList || (atIndex >= 0 && (!userInfo || userInfo.includes('@')))) {
    throw new ConfigError('MONGODB_URI must include valid credentials and a host.')
  }

  if (userInfo) {
    try {
      decodeURIComponent(userInfo)
    } catch {
      throw new ConfigError('MONGODB_URI contains malformed URL-encoded credentials.')
    }
  }

  if (protocol === 'mongodb+srv:') {
    if (hostList.includes(',')) {
      throw new ConfigError('MONGODB_URI must use one host with mongodb+srv://.')
    }

    try {
      const parsed = new URL(normalized)
      if (!parsed.hostname || parsed.port) throw new Error('Invalid SRV host')
    } catch {
      throw new ConfigError('MONGODB_URI must be a valid MongoDB connection string.')
    }

    return normalized
  }

  const hosts = hostList.split(',')
  if (hosts.some((host) => !host)) {
    throw new ConfigError('MONGODB_URI must include valid MongoDB host names.')
  }
  hosts.forEach(validateMongoHost)

  try {
    const parsed = new URL('mongodb://' + hosts[0] + suffix)
    if (!parsed.hostname) throw new Error('Missing host')
  } catch {
    throw new ConfigError('MONGODB_URI must be a valid MongoDB connection string.')
  }

  return normalized
}

function validatePort(value) {
  if (value === undefined || value === '') {
    return DEFAULT_PORT
  }

  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError('PORT must be an integer between 1 and 65535.')
  }

  return port
}

function validateCorsOrigin(value, productionLike) {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (normalized === '') {
    if (productionLike) {
      throw new ConfigError('CORS_ORIGIN is required outside development and test environments.')
    }

    return DEFAULT_CORS_ORIGIN
  }

  if (normalized === '*') {
    throw new ConfigError('CORS_ORIGIN cannot be a wildcard when credentialed sessions are enabled.')
  }

  let parsed
  try {
    parsed = new URL(normalized)
  } catch {
    throw new ConfigError('CORS_ORIGIN must be a valid HTTP or HTTPS origin.')
  }

  const allowedProtocols = productionLike ? ['https:'] : ['http:', 'https:']
  if (!allowedProtocols.includes(parsed.protocol) || parsed.origin !== normalized) {
    throw new ConfigError(productionLike
      ? 'CORS_ORIGIN must be an exact HTTPS origin without a path outside development and test environments.'
      : 'CORS_ORIGIN must be an exact HTTP or HTTPS origin without a path.')
  }

  return parsed.origin
}

function validateSessionTtlHours(value) {
  if (value === undefined || value === '') {
    return DEFAULT_SESSION_TTL_HOURS
  }

  const hours = Number(value)
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
    throw new ConfigError('SESSION_TTL_HOURS must be an integer between 1 and 168.')
  }

  return hours
}

function validatePasswordHash(value) {
  const normalized = requireString(value, 'ADMIN_PASSWORD_HASH')

  try {
    if (bcrypt.getRounds(normalized) < MIN_BCRYPT_ROUNDS) {
      throw new ConfigError(`ADMIN_PASSWORD_HASH must use bcrypt cost ${MIN_BCRYPT_ROUNDS} or higher.`)
    }
  } catch (error) {
    if (error instanceof ConfigError) throw error
    throw new ConfigError('ADMIN_PASSWORD_HASH must be a valid bcrypt hash.')
  }

  return normalized
}

export function loadConfig(env = process.env) {
  const nodeEnv = typeof env.NODE_ENV === 'string' && env.NODE_ENV.trim()
    ? env.NODE_ENV.trim().toLowerCase()
    : 'production'
  const productionLike = !['development', 'test'].includes(nodeEnv)
  const sessionSecret = requireString(env.SESSION_SECRET, 'SESSION_SECRET')

  if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH) {
    throw new ConfigError(`SESSION_SECRET must be at least ${MIN_SESSION_SECRET_LENGTH} characters long.`)
  }

  return {
    nodeEnv,
    productionLike,
    port: validatePort(env.PORT),
    mongoUri: validateMongoUri(env.MONGODB_URI),
    corsOrigin: validateCorsOrigin(env.CORS_ORIGIN, productionLike),
    adminUsername: requireString(env.ADMIN_USERNAME, 'ADMIN_USERNAME'),
    adminPasswordHash: validatePasswordHash(env.ADMIN_PASSWORD_HASH),
    sessionSecret,
    sessionTtlMs: validateSessionTtlHours(env.SESSION_TTL_HOURS) * 60 * 60 * 1000,
  }
}
