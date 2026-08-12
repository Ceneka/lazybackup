import {
  createSessionCookieValue,
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
  getAuthenticationOptions,
  verifyAuthentication,
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

/** GET /api/auth/webauthn/login — authentication options (public) */
export async function GET(request: NextRequest) {
  try {
    const { rpID } = webauthnRpFromRequest(request)
    const options = await getAuthenticationOptions(rpID)
    return NextResponse.json(options)
  } catch (error) {
    console.error('WebAuthn login options failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start passkey login' },
      { status: 400 }
    )
  }
}

const verifySchema = z.object({
  response: z.unknown(),
})

/** POST /api/auth/webauthn/login — verify assertion + set session */
export async function POST(request: NextRequest) {
  const limitKey = rateLimitKey('webauthn-login', clientKeyFromRequest(request))
  const limited = assertNotRateLimited(limitKey)
  if (!limited.ok) return tooManyAttempts(limited.retryAfterSec)

  try {
    const body = verifySchema.parse(await request.json())
    const { rpID, origin } = webauthnRpFromRequest(request)
    await verifyAuthentication({
      response: body.response as never,
      expectedOrigin: origin,
      expectedRPID: rpID,
    })

    recordAuthSuccess(limitKey)
    const token = await createSessionCookieValue()
    const response = NextResponse.json({ ok: true })
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
    console.error('WebAuthn login verify failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Passkey login failed' },
      { status: 401 }
    )
  }
}
