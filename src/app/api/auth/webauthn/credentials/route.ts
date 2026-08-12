import { isSessionAuthorized } from '@/lib/auth'
import { countPasskeys, deletePasskey, listPasskeys } from '@/lib/auth/webauthn'
import { getPasswordHash } from '@/lib/auth/settings'
import { NextRequest, NextResponse } from 'next/server'

async function requireSession(request: NextRequest) {
  const ok = await isSessionAuthorized(request.headers.get('cookie'))
  if (!ok) {
    return NextResponse.json(
      { error: 'Session required to manage passkeys' },
      { status: 401 }
    )
  }
  return null
}

/** GET /api/auth/webauthn/credentials — list passkeys */
export async function GET(request: NextRequest) {
  const denied = await requireSession(request)
  if (denied) return denied
  try {
    const passkeys = await listPasskeys()
    return NextResponse.json({ passkeys })
  } catch (error) {
    console.error('List passkeys failed:', error)
    return NextResponse.json({ error: 'Failed to list passkeys' }, { status: 500 })
  }
}

/** DELETE /api/auth/webauthn/credentials?id=… */
export async function DELETE(request: NextRequest) {
  const denied = await requireSession(request)
  if (denied) return denied
  try {
    const id = request.nextUrl.searchParams.get('id')
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const remaining = (await countPasskeys()) - 1
    const hasPassword = Boolean(await getPasswordHash())
    if (remaining <= 0 && !hasPassword) {
      // Deleting last passkey with no password unlocks the instance — allow it
    }

    await deletePasskey(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Delete passkey failed:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete passkey' },
      { status: 400 }
    )
  }
}
