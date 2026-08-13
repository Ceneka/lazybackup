import { describe, expect, test } from 'bun:test'
import net from 'node:net'
import { alreadyRunningMessage, isAddressInUseError, isPortInUse } from './listen'

describe('listen helpers', () => {
  test('already-running message points at localhost UI', () => {
    expect(alreadyRunningMessage(3789)).toBe(
      'LazyBro is already running at http://127.0.0.1:3789'
    )
  })

  test('isAddressInUseError matches EADDRINUSE', () => {
    expect(isAddressInUseError({ code: 'EADDRINUSE' })).toBe(true)
    expect(isAddressInUseError(new Error('listen EADDRINUSE: address already in use'))).toBe(
      true
    )
    expect(isAddressInUseError(new Error('nope'))).toBe(false)
  })

  test('isPortInUse detects a bound port', async () => {
    const server = net.createServer()
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    if (!addr || typeof addr === 'string') throw new Error('expected tcp address')
    try {
      expect(await isPortInUse(addr.port)).toBe(true)
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve()))
      )
    }
    expect(await isPortInUse(addr.port)).toBe(false)
  })
})
