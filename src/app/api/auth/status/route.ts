import {
  getAuthStatus,
  maybeRefreshSessionCookie,
} from '@/lib/auth'
import { countPasskeys } from '@/lib/auth/webauthn'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/auth/status — public; used by middleware and UI.
// Sliding cookie refresh uses an idle window (not every request).
export async function GET(request: NextRequest) {
  try {
    const cookieHeader = request.headers.get('cookie')
    const status = await getAuthStatus(cookieHeader)
    // getAuthStatus only includes the count for authenticated sessions; the UI
    // type declares it optional, so always report the real number.
    const passkeyCount = status.passkeyCount ?? (await countPasskeys())
    const response = NextResponse.json({ ...status, passkeyCount })

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
