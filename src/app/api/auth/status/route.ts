import {
  createSessionCookieValue,
  getAuthStatus,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/auth/status — public; used by middleware and UI.
// When authenticated, refreshes the session cookie (sliding 30-day expiry).
export async function GET(request: NextRequest) {
  try {
    const status = await getAuthStatus(request.headers.get('cookie'))
    const response = NextResponse.json(status)

    if (status.authEnabled && status.authenticated) {
      const token = await createSessionCookieValue()
      response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions())
    }

    return response
  } catch (error) {
    console.error('Failed to get auth status:', error)
    return NextResponse.json(
      { error: 'Failed to get auth status' },
      { status: 500 }
    )
  }
}
