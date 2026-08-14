import {
  clearSessionCookieOptions,
  isSessionAuthorized,
  SESSION_COOKIE_NAME,
} from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/auth/logout — authenticated, caller-local logout.
export async function POST(request: NextRequest) {
  if (!(await isSessionAuthorized(request.headers.get('cookie')))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE_NAME, '', clearSessionCookieOptions())
  return response
}
