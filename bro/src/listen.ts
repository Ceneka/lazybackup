import net from 'node:net'

export function alreadyRunningMessage(port: number): string {
  return `LazyBro is already running at http://127.0.0.1:${port}`
}

/** True if something is accepting connections on host:port. */
export function isPortInUse(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    socket.once('connect', () => {
      socket.end()
      resolve(true)
    })
    socket.once('error', () => {
      resolve(false)
    })
  })
}

export function isAddressInUseError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: string; message?: string }
  if (e.code === 'EADDRINUSE') return true
  return /EADDRINUSE|address already in use|already in use/i.test(e.message ?? '')
}
