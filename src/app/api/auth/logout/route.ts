import {
  bumpSessionEpoch,
  clearSessionCookieOptions,
  SESSION_COOKIE_NAME,
} from '@/lib/auth'
import { NextResponse } from 'next/server'

// POST /api/auth/logout — clears this cookie and bumps sessionEpoch (logout-all).
export async function POST() {
  try {
    await bumpSessionEpoch()
  } catch (error) {
    console.error('Failed to revoke sessions on logout:', error)
    return NextResponse.json({ error: 'Failed to logout' }, { status: 500 })
  }
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE_NAME, '', clearSessionCookieOptions())
  return response
}
