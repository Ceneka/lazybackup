import {
  RemoteExecPermissionError,
  authAllowsRemoteExec,
  resolveAuth,
  writeAuditLog,
} from '@/lib/auth'
import { execRemoteCommand } from '@/lib/ssh/exec-remote'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

export const runtime = 'nodejs'

const bodySchema = z.object({
  command: z.string().min(1, 'Command is required').max(8000),
  confirm: z.boolean(),
  timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
})

// POST /api/servers/:id/exec — run a shell command on the server (requires remote_exec for Bearer)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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
    if (!authAllowsRemoteExec(auth)) {
      return NextResponse.json({ error: new RemoteExecPermissionError().message }, { status: 403 })
    }

    const body = bodySchema.parse(await request.json())
    if (!body.confirm) {
      return NextResponse.json(
        { error: 'Refusing to execute: pass confirm=true to proceed' },
        { status: 400 }
      )
    }

    const actor = auth.apiToken
      ? { tokenId: auth.apiToken.id, tokenName: auth.apiToken.name }
      : auth.via === 'session'
        ? { tokenName: 'session' }
        : undefined

    try {
      const result = await execRemoteCommand(id, body.command, {
        timeoutMs: body.timeoutMs,
      })
      await writeAuditLog(actor, 'exec_command', {
        detail: `${result.serverName}: ${result.command.slice(0, 200)}`,
        ok: true,
      })
      return NextResponse.json(result)
    } catch (error) {
      await writeAuditLog(actor, 'exec_command', {
        detail: `${id}: ${error instanceof Error ? error.message : 'error'}`,
        ok: false,
      })
      throw error
    }
  } catch (error) {
    console.error('Failed to execute remote command:', error)
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.issues },
        { status: 400 }
      )
    }
    const message = error instanceof Error ? error.message : 'Failed to execute command'
    const status = message.startsWith('Server not found') ? 404 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
