import {
  createSessionCookieValue,
  getAuthStatus,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from '@/lib/auth'
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

/**
 * Auth gate on the Node.js runtime so we can read SQLite / verify the session
 * in-process. Do not HTTP self-fetch /api/auth/status: Edge→LAN Host hangs,
 * and Edge→127.0.0.1 often fails — which fail-opens pages but 401s APIs.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  try {
    const status = await getAuthStatus(request.headers.get('cookie'))

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
    if (status.authEnabled && status.authenticated) {
      const token = await createSessionCookieValue()
      response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions())
    }
    return response
  } catch (error) {
    console.error('Auth middleware error:', error)
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.next()
  }
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
