import {
  createSessionCookieValue,
  getPasswordHash,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  verifyPassword,
} from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const loginSchema = z.object({
  password: z.string().min(1, 'Password is required'),
})

// POST /api/auth/login
export async function POST(request: NextRequest) {
  try {
    const passwordHash = await getPasswordHash()
    if (!passwordHash) {
      return NextResponse.json(
        { error: 'Login is not enabled' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const { password } = loginSchema.parse(body)

    const valid = await verifyPassword(password, passwordHash)
    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid password' },
        { status: 401 }
      )
    }

    const token = await createSessionCookieValue()
    const response = NextResponse.json({ ok: true })
    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions())
    return response
  } catch (error) {
    console.error('Failed to login:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      )
    }
    return NextResponse.json({ error: 'Failed to login' }, { status: 500 })
  }
}
