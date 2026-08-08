import { SESSION_COOKIE_NAME } from '@/lib/auth'
import { NextResponse } from 'next/server'

// POST /api/auth/logout
export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  })
  return response
}
