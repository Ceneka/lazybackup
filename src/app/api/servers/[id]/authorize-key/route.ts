import {
  AUTHORIZE_KEYS_DENIED,
  authAllowsAuthorizeKeys,
  resolveAuth,
  writeAuditLog,
} from '@/lib/auth'
import {
  InvalidPublicKeyError,
  updateAuthorizedKeyOnServer,
  type AuthorizeKeyAction,
} from '@/lib/ssh/authorize-key'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'

const bodySchema = z.object({
  publicKey: z.string().min(1, 'publicKey is required').max(8_192),
})

async function handle(
  request: NextRequest,
  params: Promise<{ id: string }>,
  action: AuthorizeKeyAction
) {
  const { id } = await params
  try {
    const auth = await resolveAuth(
      request.headers.get('cookie'),
      request.headers.get('authorization')
    )
    if (!auth.authorized) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!authAllowsAuthorizeKeys(auth)) {
      return NextResponse.json({ error: AUTHORIZE_KEYS_DENIED }, { status: 403 })
    }

    const body = bodySchema.parse(await request.json())
    const actor = auth.apiToken
      ? { tokenId: auth.apiToken.id, tokenName: auth.apiToken.name }
      : auth.via === 'session'
        ? { tokenName: 'session' }
        : undefined
    const auditAction = action === 'authorize' ? 'authorize_key' : 'revoke_key'

    try {
      const result = await updateAuthorizedKeyOnServer(id, body.publicKey, action)
      await writeAuditLog(actor, auditAction, {
        detail: `${result.serverName}: ${result.fingerprint} ${result.status}`,
        ok: true,
      })
      return NextResponse.json({ ok: true, ...result })
    } catch (error) {
      if (!(error instanceof InvalidPublicKeyError)) {
        await writeAuditLog(actor, auditAction, {
          detail: `${id}: ${error instanceof Error ? error.message : 'error'}`,
          ok: false,
        })
      }
      throw error
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      )
    }
    if (error instanceof InvalidPublicKeyError) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    console.error('Failed to update authorized key:', error)
    const message = error instanceof Error ? error.message : 'Failed to update authorized key'
    const status = message.startsWith('Server not found') ? 404 : 502
    return NextResponse.json({ error: message }, { status })
  }
}

// POST /api/servers/:id/authorize-key — add a public key to the server's authorized_keys
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(request, params, 'authorize')
}

// DELETE /api/servers/:id/authorize-key — remove that public key again
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return handle(request, params, 'revoke')
}
