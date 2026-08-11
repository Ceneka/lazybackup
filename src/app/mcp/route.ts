import { resolveAuth } from '@/lib/auth'
import { registerLazyBackupTools } from '@/lib/mcp/register'
import { createMcpHandler } from 'mcp-handler'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Streamable HTTP MCP endpoint.
 * Auth: same as /api/* — session cookie or Authorization: Bearer <api-token>
 * (enforced here and in middleware).
 */
async function handle(req: Request) {
  const resolved = await resolveAuth(
    req.headers.get('cookie'),
    req.headers.get('authorization')
  )
  if (!resolved.authorized) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const actor = resolved.apiToken
    ? { tokenId: resolved.apiToken.id, tokenName: resolved.apiToken.name }
    : resolved.via === 'session'
      ? { tokenName: 'session' }
      : undefined

  const requestHandler = createMcpHandler(
    (server) => {
      registerLazyBackupTools(server, actor)
    },
    {
      serverInfo: {
        name: 'lazybackup',
        version: '0.1.0',
      },
      instructions: `You are connected to LazyBackup, a self-hosted From→To backup manager.
Use list_backups / get_dashboard to inspect state; run_backup to start jobs; create_backup/update_backup for configs.
Destructive tools (delete_*, restore_history) require confirm=true.
Never invent server IDs — call list_servers / list_s3_profiles first.`,
    }
  )

  return requestHandler(req)
}

export { handle as GET, handle as POST, handle as DELETE }
