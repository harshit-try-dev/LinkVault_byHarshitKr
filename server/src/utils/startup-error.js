import { getErrorDiagnostics } from './error-diagnostics.js'

export function unexpectedStartupErrorMessage(error) {
  const { name, code, message } = getErrorDiagnostics(error)
  return `[startup] Server could not start. name=${name} code=${code} message=${message}`
}
