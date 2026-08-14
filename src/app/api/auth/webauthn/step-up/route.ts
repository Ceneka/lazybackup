import { isSessionAuthorized } from '@/lib/auth'
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
import { issueVaultStepUpToken } from '@/lib/crypto/vault-step-up'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

async function requireSession(request: NextRequest) {
  if (await isSessionAuthorized(request.headers.get('cookie'))) return null
  return NextResponse.json({ error: 'Session required' }, { status: 401 })
}

export async function GET(request: NextRequest) {
  const denied = await requireSession(request)
  if (denied) return denied
  try {
    const { rpID } = webauthnRpFromRequest(request)
    return NextResponse.json(await getAuthenticationOptions(rpID, 'step-up'))
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to start passkey verification' },
      { status: 400 }
    )
  }
}

const verifySchema = z.object({ response: z.unknown() })

export async function POST(request: NextRequest) {
  const denied = await requireSession(request)
  if (denied) return denied

  const limitKey = rateLimitKey('webauthn-step-up', clientKeyFromRequest(request))
  const limited = assertNotRateLimited(limitKey)
  if (!limited.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(limited.retryAfterSec) } }
    )
  }

  try {
    const body = verifySchema.parse(await request.json())
    const { rpID, origin } = webauthnRpFromRequest(request)
    await verifyAuthentication({
      response: body.response as never,
      expectedOrigin: origin,
      expectedRPID: rpID,
      kind: 'step-up',
    })
    recordAuthSuccess(limitKey)
    const stepUpToken = issueVaultStepUpToken(request.headers.get('cookie'))
    return NextResponse.json({ stepUpToken, expiresInSeconds: 120 })
  } catch (error) {
    recordAuthFailure(limitKey)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Passkey verification failed' },
      { status: error instanceof z.ZodError ? 400 : 401 }
    )
  }
}
