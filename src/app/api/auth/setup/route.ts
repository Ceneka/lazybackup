import {
  assertPasswordStrength,
  bumpSessionEpoch,
  claimFirstPasswordHash,
  createSessionCookieValue,
  hashPassword,
  isAuthEnabled,
  markAuthSetupCompleted,
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
} from '@/lib/auth'
import {
  assertNotRateLimited,
  clientKeyFromRequest,
  rateLimitKey,
  recordAuthFailure,
  recordAuthSuccess,
} from '@/lib/auth/rate-limit'
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

function tooManyAttempts(retryAfterSec: number) {
  return NextResponse.json(
    { error: 'Too many attempts. Try again shortly.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
  )
}

// POST /api/auth/setup — first-run set password or skip (only when no password yet).
// Not bound to loopback: Docker port-publish makes the operator's browser a remote
// client. Residual risk: anyone on the LAN can complete first-boot if they reach
// the UI before the operator. Compare-and-set below stops two setups both winning.
export async function POST(request: NextRequest) {
  const limitKey = rateLimitKey('setup', clientKeyFromRequest(request))
  const limited = assertNotRateLimited(limitKey)
  if (!limited.ok) return tooManyAttempts(limited.retryAfterSec)

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
      recordAuthSuccess(limitKey)
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

    const passwordHash = await hashPassword(data.password)
    const claimed = await claimFirstPasswordHash(passwordHash)
    if (claimed === 'already_set') {
      recordAuthFailure(limitKey)
      return NextResponse.json(
        { error: 'Password is already configured' },
        { status: 400 }
      )
    }

    await bumpSessionEpoch()
    recordAuthSuccess(limitKey)
    const token = await createSessionCookieValue()
    const response = NextResponse.json({ ok: true, skipped: false })
    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions())
    return response
  } catch (error) {
    console.error('Failed to complete auth setup:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      )
    }
    return NextResponse.json(
      { error: 'Failed to complete auth setup' },
      { status: 500 }
    )
  }
}
