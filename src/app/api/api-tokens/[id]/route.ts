import { isSessionAuthorized, revokeApiToken } from '@/lib/auth'
import { NextRequest, NextResponse } from 'next/server'

// DELETE /api/api-tokens/[id] — revoke token (session only)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const ok = await isSessionAuthorized(request.headers.get('cookie'))
  if (!ok) {
    return NextResponse.json(
      { error: 'Session required to manage API tokens' },
      { status: 401 }
    )
  }

  try {
    const { id } = await params
    const revoked = await revokeApiToken(id)
    if (!revoked) {
      return NextResponse.json({ error: 'Token not found or already revoked' }, { status: 404 })
    }
    return NextResponse.json(revoked)
  } catch (error) {
    console.error('Failed to revoke API token:', error)
    return NextResponse.json({ error: 'Failed to revoke API token' }, { status: 500 })
  }
}
