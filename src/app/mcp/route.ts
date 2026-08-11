import { authAllowsRemoteExec, resolveAuth } from '@/lib/auth'
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

  const canRemoteExec = authAllowsRemoteExec(resolved)

  const requestHandler = createMcpHandler(
    (server) => {
      registerLazyBackupTools(server, { actor, canRemoteExec })
    },
    {
      serverInfo: {
        name: 'lazybackup',
        version: '0.1.0',
      },
      instructions: `You are connected to LazyBackup, a self-hosted From→To backup manager.
Never invent server, volume, container, or S3 profile names/ids — call find_server, list_docker_volumes, list_docker_containers, get_container_db_hints, list_s3_profiles first.
Verify with test_server / test_database before create_backup when possible.
Use list_backups / get_dashboard to inspect state; run_backup to start jobs.
Destructive tools (delete_*, restore_history, exec_command) require confirm=true.
exec_command and changing preBackupCommands require the API token remote_exec permission (or a browser session). Prefer exec_command for one-off shell instead of abusing preBackupCommands.`,
    }
  )

  return requestHandler(req)
}

export { handle as GET, handle as POST, handle as DELETE }
