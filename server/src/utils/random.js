import { randomBytes } from 'node:crypto'

const SHORT_CODE_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function generateShortCode(length = 7) {
  let code = ''
  const usableByteLimit = 256 - (256 % SHORT_CODE_ALPHABET.length)

  while (code.length < length) {
    const bytes = randomBytes(length)
    for (const byte of bytes) {
      if (byte >= usableByteLimit) {
        continue
      }

      code += SHORT_CODE_ALPHABET[byte % SHORT_CODE_ALPHABET.length]
      if (code.length === length) {
        break
      }
    }
  }

  return code
}

