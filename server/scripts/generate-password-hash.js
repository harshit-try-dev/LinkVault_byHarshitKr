import bcrypt from 'bcryptjs'

if (!process.stdin.isTTY || !process.stdin.setRawMode) {
  console.error('Run this utility interactively so the password is not supplied in a command argument.')
  process.exitCode = 1
} else {
  const password = []
  process.stdout.write('Password: ')
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')

  function finish() {
    process.stdin.setRawMode(false)
    process.stdin.pause()
    process.stdout.write('\n')
  }

  process.stdin.on('data', async (chunk) => {
    for (const character of chunk) {
      if (character === '\u0003') {
        finish()
        process.exitCode = 130
        return
      }

      if (character === '\r' || character === '\n') {
        finish()
        if (password.length === 0) {
          console.error('Password must not be empty.')
          process.exitCode = 1
          return
        }

        console.log(await bcrypt.hash(password.join(''), 12))
        return
      }

      if (character === '\u007f' || character === '\b') {
        password.pop()
      } else {
        password.push(character)
      }
    }
  })
}
