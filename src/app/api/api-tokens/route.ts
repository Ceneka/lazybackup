import {
  createApiToken,
  isSessionAuthorized,
  listApiTokens,
} from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

const createSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
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

// POST /api/api-tokens — create token (session only; plaintext returned once)
export async function POST(request: NextRequest) {
  const denied = await requireSession(request)
  if (denied) return denied

  try {
    const body = await request.json()
    const { name } = createSchema.parse(body)
    const { token, plaintext } = await createApiToken(name)
    return NextResponse.json({ ...token, token: plaintext }, { status: 201 })
  } catch (error) {
    console.error('Failed to create API token:', error)
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
