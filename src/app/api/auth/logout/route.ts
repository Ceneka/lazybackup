import { clearSessionCookieOptions, SESSION_COOKIE_NAME } from '@/lib/auth'
import { NextResponse } from 'next/server'

// POST /api/auth/logout
export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE_NAME, '', clearSessionCookieOptions())
  return response
}
