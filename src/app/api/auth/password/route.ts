import {
  assertPasswordStrength,
  bumpSessionEpoch,
  clearPasswordHash,
  clearSessionCookieOptions,
  createSessionCookieValue,
  getPasswordHash,
  hashPassword,
  isAuthorized,
  isSessionAuthorized,
  markAuthSetupCompleted,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  setPasswordHash,
  verifyPassword,
} from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const passwordSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('set'),
    password: z.string().min(1),
  }),
  z.object({
    action: z.literal('change'),
    currentPassword: z.string().min(1),
    password: z.string().min(1),
  }),
  z.object({
    action: z.literal('remove'),
    currentPassword: z.string().min(1),
  }),
])

// POST /api/auth/password — set / change / remove app password
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const data = passwordSchema.parse(body)
    const existingHash = await getPasswordHash()
    const cookieHeader = request.headers.get('cookie')

    if (data.action === 'set') {
      if (existingHash) {
        return NextResponse.json(
          { error: 'Password is already set. Use change instead.' },
          { status: 400 }
        )
      }

      // Cookie session only — never Bearer. Unlocked first-run still allowed
      // (Settings after skip); passkey-only operators must be logged in.
      if (!(await isSessionAuthorized(cookieHeader))) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const strengthError = assertPasswordStrength(data.password)
      if (strengthError) {
        return NextResponse.json({ error: strengthError }, { status: 400 })
      }

      const passwordHash = await hashPassword(data.password)
      await setPasswordHash(passwordHash)
      await markAuthSetupCompleted()
      await bumpSessionEpoch()

      const token = await createSessionCookieValue()
      const response = NextResponse.json({ ok: true, authEnabled: true })
      response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions())
      return response
    }

    // change / remove require an existing password and authorization
    if (!existingHash) {
      return NextResponse.json(
        { error: 'No password is configured' },
        { status: 400 }
      )
    }

    if (!(await isAuthorized(cookieHeader))) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const currentValid = await verifyPassword(
      data.currentPassword,
      existingHash
    )
    if (!currentValid) {
      return NextResponse.json(
        { error: 'Current password is incorrect' },
        { status: 401 }
      )
    }

    if (data.action === 'change') {
      const strengthError = assertPasswordStrength(data.password)
      if (strengthError) {
        return NextResponse.json({ error: strengthError }, { status: 400 })
      }

      const passwordHash = await hashPassword(data.password)
      await setPasswordHash(passwordHash)
      await bumpSessionEpoch()

      const token = await createSessionCookieValue()
      const response = NextResponse.json({ ok: true, authEnabled: true })
      response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions())
      return response
    }

    // remove
    await clearPasswordHash()
    const { countPasskeys } = await import('@/lib/auth/webauthn')
    const stillLocked = (await countPasskeys()) > 0
    const response = NextResponse.json({ ok: true, authEnabled: stillLocked })
    if (stillLocked) {
      const token = await createSessionCookieValue()
      response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions())
    } else {
      response.cookies.set(SESSION_COOKIE_NAME, '', clearSessionCookieOptions())
    }
    return response
  } catch (error) {
    console.error('Failed to update password:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to update password' },
      { status: 500 }
    )
  }
}
