import { NextRequest, NextResponse } from 'next/server'

const PUBLIC_EXACT = new Set([
  '/login',
  '/api/health',
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/setup',
  '/api/auth/logout',
])

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true
  // Static assets / Next internals
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.webp')
  ) {
    return true
  }
  return false
}

/** Forward Set-Cookie from internal status fetch (session sliding refresh). */
function forwardSetCookies(from: Response, to: NextResponse): void {
  const getSetCookie = (
    from.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie
  const cookies =
    typeof getSetCookie === 'function'
      ? getSetCookie.call(from.headers)
      : []

  if (cookies.length > 0) {
    for (const cookie of cookies) {
      to.headers.append('Set-Cookie', cookie)
    }
    return
  }

  const single = from.headers.get('set-cookie')
  if (single) {
    to.headers.append('Set-Cookie', single)
  }
}

/**
 * Always call auth status on loopback. Using `request.url` (e.g.
 * http://192.168.x.x:3000 from a LAN browser) makes the container fetch its
 * published host IP, which often hangs on Docker/hairpin NAT — "/" then loads forever.
 */
function internalAuthStatusUrl(): string {
  const port = process.env.PORT || '3000'
  return `http://127.0.0.1:${port}/api/auth/status`
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  try {
    const statusRes = await fetch(internalAuthStatusUrl(), {
      headers: {
        cookie: request.headers.get('cookie') ?? '',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    })

    if (!statusRes.ok) {
      // Fail open on status errors so a transient DB blip does not lock the UI forever
      // when auth is not configured. When auth is on, API routes still need a session;
      // prefer blocking API on unknown status.
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.next()
    }

    const status = (await statusRes.json()) as {
      authEnabled?: boolean
      authenticated?: boolean
    }

    if (status.authEnabled && !status.authenticated) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const loginUrl = new URL('/login', request.url)
      const from = pathname + request.nextUrl.search
      if (from && from !== '/') {
        loginUrl.searchParams.set('from', from)
      }
      return NextResponse.redirect(loginUrl)
    }

    const response = NextResponse.next()
    // Propagate refreshed session cookie from status (sliding expiry)
    if (status.authEnabled && status.authenticated) {
      forwardSetCookies(statusRes, response)
    }
    return response
  } catch (error) {
    console.error('Auth middleware error:', error)
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all paths except static files handled above via isPublicPath.
     * Keep matcher broad; allowlist is in code.
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
