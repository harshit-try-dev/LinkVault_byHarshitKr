export function sanitizeDiagnosticMessage(message) {
  return String(message || 'Startup failed.')
    .replace(/mongodb(?:\+srv)?:\/\/[^\s'"`]+/gi, 'mongodb://[redacted]')
    .replace(/(?:mongodb_uri|password|passwd|pwd|secret|token)\s*[:=]\s*[^\s,;]+/gi, '[redacted]')
    .replace(/(?:authorization|access[_ -]?token|management[_ -]?token)\s*[:=]\s*(?:bearer\s+)?[^\s,;]+/gi, '[redacted]')
    .replace(/\bbearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
    .replace(/(?:username|user)\s*[:=]\s*["']?[^\s,"']+["']?/gi, '[redacted]')
    .replace(/for\s+user\s+["']?[^\s,"']+["']?/gi, 'for user [redacted]')
}

export function getErrorDiagnostics(error, fallbackMessage = 'Startup failed.') {
  return {
    name: error?.name || 'UnknownError',
    code: error?.code ?? 'UNKNOWN',
    message: sanitizeDiagnosticMessage(error?.message || fallbackMessage),
  }
}
