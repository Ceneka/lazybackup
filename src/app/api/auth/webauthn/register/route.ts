import {
  createSessionCookieValue,
  requireLockedBrowserSession,
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
import {
  getRegistrationOptions,
  verifyAndStoreRegistration,
  webauthnRpFromRequest,
} from '@/lib/auth/webauthn'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

function tooManyAttempts(retryAfterSec: number) {
  return NextResponse.json(
    { error: 'Too many attempts. Try again shortly.' },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } }
  )
}

async function requireSession(request: NextRequest) {
  const ok = await requireLockedBrowserSession(request.headers.get('cookie'))
  if (!ok) {
    return NextResponse.json(
      { error: 'Session required to register passkeys' },
      { status: 401 }
    )
  }
  return null
}

/** GET /api/auth/webauthn/register — registration options (locked session required) */
export async function GET(request: NextRequest) {
  const denied = await requireSession(request)
  if (denied) return denied
  try {
    const { rpID } = webauthnRpFromRequest(request)
    const options = await getRegistrationOptions(rpID)
    return NextResponse.json(options)
  } catch (error) {
    console.error('WebAuthn register options failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start registration' },
      { status: 400 }
    )
  }
}

const verifySchema = z.object({
  response: z.unknown(),
  name: z.string().optional(),
})

/** POST /api/auth/webauthn/register — verify + store credential */
export async function POST(request: NextRequest) {
  const denied = await requireSession(request)
  if (denied) return denied

  const limitKey = rateLimitKey('webauthn-register', clientKeyFromRequest(request))
  const limited = assertNotRateLimited(limitKey)
  if (!limited.ok) return tooManyAttempts(limited.retryAfterSec)

  try {
    const body = verifySchema.parse(await request.json())
    const { rpID, origin } = webauthnRpFromRequest(request)
    const passkey = await verifyAndStoreRegistration({
      response: body.response as never,
      expectedOrigin: origin,
      expectedRPID: rpID,
      name: body.name,
    })
    await markAuthSetupCompleted()
    recordAuthSuccess(limitKey)
    const token = await createSessionCookieValue()
    const response = NextResponse.json({ passkey }, { status: 201 })
    response.cookies.set(SESSION_COOKIE_NAME, token, sessionCookieOptions())
    return response
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      )
    }
    recordAuthFailure(limitKey)
    console.error('WebAuthn register verify failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Registration failed' },
      { status: 400 }
    )
  }
}
