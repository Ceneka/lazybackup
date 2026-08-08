import {
  assertPasswordStrength,
  createSessionCookieValue,
  getPasswordHash,
  hashPassword,
  isAuthEnabled,
  markAuthSetupCompleted,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  setPasswordHash,
} from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const setupSchema = z.union([
  z.object({
    skip: z.literal(true),
  }),
  z.object({
    password: z.string().min(1),
    skip: z.literal(true).optional(),
  }),
])

// POST /api/auth/setup — first-run set password or skip (only when no password yet)
export async function POST(request: NextRequest) {
  try {
    if (await isAuthEnabled()) {
      return NextResponse.json(
        { error: 'Password is already configured' },
        { status: 400 }
      )
    }

    const body = await request.json()
    const data = setupSchema.parse(body)

    if ('skip' in data && data.skip === true && !('password' in data)) {
      await markAuthSetupCompleted()
      return NextResponse.json({ ok: true, skipped: true })
    }

    if (!('password' in data) || !data.password) {
      return NextResponse.json(
        { error: 'Password is required' },
        { status: 400 }
      )
    }

    const strengthError = assertPasswordStrength(data.password)
    if (strengthError) {
      return NextResponse.json({ error: strengthError }, { status: 400 })
    }

    // Race guard: re-check before write
    if (await getPasswordHash()) {
      return NextResponse.json(
        { error: 'Password is already configured' },
        { status: 400 }
      )
    }

    const passwordHash = await hashPassword(data.password)
    await setPasswordHash(passwordHash)
    await markAuthSetupCompleted()

    const token = await createSessionCookieValue()
    const response = NextResponse.json({ ok: true, skipped: false })
    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions())
    return response
  } catch (error) {
    console.error('Failed to complete auth setup:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to complete auth setup' },
      { status: 500 }
    )
  }
}
