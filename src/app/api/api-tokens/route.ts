import {
  createApiToken,
  isSessionAuthorized,
  listApiTokens,
  normalizeApiTokenPermissionsInput,
  requireLockedBrowserSession,
} from '@/lib/auth'
import {
  requireCredentialStepUp,
  VaultStepUpError,
} from '@/lib/crypto/vault-step-up'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const createSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  permissions: z.array(z.string()).optional(),
  currentPassword: z.string().optional(),
  stepUpToken: z.string().min(20).optional(),
})

async function requireSession(request: NextRequest) {
  const ok = await isSessionAuthorized(request.headers.get('cookie'))
  if (!ok) {
    return NextResponse.json(
      { error: 'Session required to manage API tokens' },
      { status: 401 }
    )
  }
  return null
}

// GET /api/api-tokens — list tokens (session only; never returns plaintext)
export async function GET(request: NextRequest) {
  const denied = await requireSession(request)
  if (denied) return denied

  try {
    const includeRevoked = request.nextUrl.searchParams.get('includeRevoked') === '1'
    const tokens = await listApiTokens(includeRevoked)
    return NextResponse.json(tokens)
  } catch (error) {
    console.error('Failed to list API tokens:', error)
    return NextResponse.json({ error: 'Failed to list API tokens' }, { status: 500 })
  }
}

// POST /api/api-tokens — create token (locked browser session only; plaintext returned once)
export async function POST(request: NextRequest) {
  const locked = await requireLockedBrowserSession(request.headers.get('cookie'))
  if (!locked) {
    return NextResponse.json(
      { error: 'Session required to manage API tokens' },
      { status: 401 }
    )
  }

  try {
    const body = await request.json()
    const { name, permissions: rawPermissions, currentPassword, stepUpToken } =
      createSchema.parse(body)

    // Minting a durable credential needs fresh proof beyond the session cookie.
    await requireCredentialStepUp(
      { currentPassword, stepUpToken },
      request.headers.get('cookie'),
      request
    )

    const permissions = normalizeApiTokenPermissionsInput(rawPermissions)
    const { token, plaintext } = await createApiToken(name, permissions)
    return NextResponse.json({ ...token, token: plaintext }, { status: 201 })
  } catch (error) {
    console.error('Failed to create API token:', error)
    if (error instanceof VaultStepUpError) {
      return NextResponse.json(
        { error: error.message },
        {
          status: error.status,
          headers: error.retryAfterSec
            ? { 'Retry-After': String(error.retryAfterSec) }
            : undefined,
        }
      )
    }
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      )
    }
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to create API token',
      },
      { status: 400 }
    )
  }
}
