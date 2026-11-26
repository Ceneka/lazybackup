import {
  getAuthStatus,
  maybeRefreshSessionCookie,
} from '@/lib/auth'
import { isPublicPath } from '@/lib/auth/public-paths'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Auth gate on the Node.js runtime so we can read SQLite / verify the session
 * in-process. Do not HTTP self-fetch /api/auth/status: Edge→LAN Host hangs,
 * and Edge→127.0.0.1 often fails — which fail-opens pages but 401s APIs.
 *
 * Accepts session cookie or Authorization: Bearer <api-token>.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  try {
    const cookieHeader = request.headers.get('cookie')
    const status = await getAuthStatus(
      cookieHeader,
      request.headers.get('authorization')
    )

    if (status.authEnabled && !status.authenticated) {
      if (pathname.startsWith('/api/') || pathname === '/mcp' || pathname.startsWith('/mcp/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const loginUrl = new URL('/login', request.url)
      const from = pathname + request.nextUrl.search
      if (from && from !== '/') {
        loginUrl.searchParams.set('from', from)
      }
      return NextResponse.redirect(loginUrl)
    }

    const { resolveAuth, authAllowsWrite, isReadOnlyApiException } = await import('@/lib/auth')
    const resolved = await resolveAuth(
      cookieHeader,
      request.headers.get('authorization')
    )
    if (
      status.authEnabled &&
      resolved.via === 'bearer' &&
      !authAllowsWrite(resolved) &&
      !isReadOnlyApiException(request.method, pathname)
    ) {
      return NextResponse.json(
        { error: 'API token is read_only' },
        { status: 403 }
      )
    }

    const response = NextResponse.next()
    const hasBearer = Boolean(request.headers.get('authorization')?.match(/^Bearer\s+/i))
    if (status.authEnabled && status.authenticated && !hasBearer) {
      await maybeRefreshSessionCookie(response, cookieHeader)
    }
    return response
  } catch (error) {
    console.error('Auth middleware error:', error)
    if (pathname.startsWith('/api/') || pathname === '/mcp' || pathname.startsWith('/mcp/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(new URL('/login', request.url))
  }
}

export const config = {
  runtime: 'nodejs',
  // Peer store/agent routes stream large request bodies and must not be
  // body-cloned by Node middleware (10 MiB default limit + async finalize).
  // Next reads this statically at build time: keep it a string literal and in
  // sync with MIDDLEWARE_MATCHER in src/lib/peer/body-routes.ts (tested).
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/peers/store$|api/peers/store/|api/peers/agent/).*)',
  ],
}
