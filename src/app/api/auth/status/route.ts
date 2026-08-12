import {
  getAuthStatus,
  maybeRefreshSessionCookie,
} from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/auth/status — public; used by middleware and UI.
// Sliding cookie refresh uses an idle window (not every request).
export async function GET(request: NextRequest) {
  try {
    const cookieHeader = request.headers.get('cookie')
    const status = await getAuthStatus(cookieHeader)
    const response = NextResponse.json(status)

    if (status.authEnabled && status.authenticated) {
      await maybeRefreshSessionCookie(response, cookieHeader)
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
