import { isBearerAudience, redactDbHints, redactServer } from '@/lib/api/redact'
import { databaseConnectionTestSchema } from '@/lib/backup/schema'
import {
  connectionFromConfig,
  testDatabaseConnectionLocal,
  testDatabaseConnectionRemote,
} from '@/lib/database'
import { writeAuditLog, type AuditActor } from '@/lib/auth/audit'
import { db } from '@/lib/db'
import { servers } from '@/lib/db/schema'
import { inspectContainerDatabaseHints, listDockerContainers } from '@/lib/docker/containers'
import { listDockerVolumes } from '@/lib/docker/volumes'
import { connectToServer } from '@/lib/ssh'
import { eq } from 'drizzle-orm'

export type McpOpsContext = {
  actor?: AuditActor
  /** Auth audience. Bearer omits live DB passwords from get_container_db_hints. */
  via?: 'unlocked' | 'session' | 'bearer' | 'none'
}

/** Session/unlocked keep the password for the form; Bearer/MCP tokens get hasPassword only. */
export function mcpIncludeDbHintPassword(via: string | undefined): boolean {
  return !isBearerAudience(via ?? 'bearer')
}

function jsonResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
  }
}

function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true as const,
  }
}

async function audited<T>(
  actor: AuditActor | undefined,
  action: string,
  detail: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  try {
    const result = await fn()
    await writeAuditLog(actor, action, { detail, ok: true })
    return result
  } catch (error) {
    await writeAuditLog(actor, action, {
      detail: detail
        ? `${detail}: ${error instanceof Error ? error.message : 'error'}`
        : undefined,
      ok: false,
    })
    throw error
  }
}

function redactServerRow(server: typeof servers.$inferSelect) {
  return redactServer(server as unknown as Record<string, unknown>)
}

/** Score how well a query matches a server (higher = better). Exported for tests. */
export function scoreServerMatch(
  query: string,
  server: { id: string; name: string; host: string }
): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  if (server.id.toLowerCase() === q) return 100
  const name = server.name.toLowerCase()
  const host = server.host.toLowerCase()
  if (name === q || host === q) return 90
  if (name.startsWith(q) || host.startsWith(q)) return 70
  if (name.includes(q) || host.includes(q)) return 50
  // token overlap (e.g. "wordpress prod" vs "WordPress Prod")
  const tokens = q.split(/[\s_/.-]+/).filter((t) => t.length >= 2)
  if (tokens.length === 0) return 0
  const hay = `${name} ${host}`
  const hits = tokens.filter((t) => hay.includes(t)).length
  if (hits === 0) return 0
  return Math.round((hits / tokens.length) * 40)
}

export async function findServerOp(_ctx: McpOpsContext, query: string, limit = 5) {
  const all = await db.select().from(servers)
  const scored = all
    .map((s) => ({
      score: scoreServerMatch(query, s),
      server: redactServerRow(s),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.min(20, Math.max(1, limit)))

  return jsonResult({
    query,
    matches: scored,
    hint:
      scored.length === 0
        ? 'No servers matched. Call list_servers and pick an exact id/name.'
        : scored[0].score >= 70
          ? 'Prefer the top match id as serverId. Do not invent names.'
          : 'Low confidence — confirm with the user or list_servers before creating a backup.',
  })
}

async function loadServer(serverId: string) {
  const server = await db.query.servers.findFirst({
    where: eq(servers.id, serverId),
  })
  if (!server) throw new Error(`Server not found: ${serverId}`)
  return server
}

export async function listDockerVolumesOp(ctx: McpOpsContext, serverId: string) {
  return audited(ctx.actor, 'list_docker_volumes', serverId, async () => {
    const server = await loadServer(serverId)
    const ssh = await connectToServer(server)
    try {
      const volumes = await listDockerVolumes(ssh)
      return jsonResult({
        serverId,
        serverName: server.name,
        volumes,
        hint: 'Use an exact volume name from this list as sourcePath when sourceType=docker_volume.',
      })
    } finally {
      ssh.dispose()
    }
  }).catch((error) =>
    errorResult(error instanceof Error ? error.message : 'Failed to list Docker volumes')
  )
}

export async function listDockerContainersOp(ctx: McpOpsContext, serverId: string) {
  return audited(ctx.actor, 'list_docker_containers', serverId, async () => {
    const server = await loadServer(serverId)
    const ssh = await connectToServer(server)
    try {
      const containers = await listDockerContainers(ssh)
      return jsonResult({
        serverId,
        serverName: server.name,
        containers,
        hint: 'Use an exact container name for database dumps (dbClient=docker) or get_container_db_hints.',
      })
    } finally {
      ssh.dispose()
    }
  }).catch((error) =>
    errorResult(
      error instanceof Error ? error.message : 'Failed to list Docker containers'
    )
  )
}

export async function getContainerDbHintsOp(
  ctx: McpOpsContext,
  serverId: string,
  container: string
) {
  return audited(ctx.actor, 'get_container_db_hints', `${serverId}:${container}`, async () => {
    const server = await loadServer(serverId)
    const ssh = await connectToServer(server)
    try {
      const hints = await inspectContainerDatabaseHints(ssh, container)
      const includePassword = mcpIncludeDbHintPassword(ctx.via)
      return jsonResult({
        serverId,
        serverName: server.name,
        hints: redactDbHints(hints as unknown as Record<string, unknown>, {
          includePassword,
        }),
        hint: hints.found
          ? 'Use these fields for create_backup (sourceType=database, dbClient=docker) then call test_database before saving.'
          : 'No DB env detected — list containers or ask the user for credentials.',
      })
    } finally {
      ssh.dispose()
    }
  }).catch((error) =>
    errorResult(
      error instanceof Error ? error.message : 'Failed to inspect container DB hints'
    )
  )
}

export async function testServerOp(ctx: McpOpsContext, serverId: string) {
  return audited(ctx.actor, 'test_server', serverId, async () => {
    const server = await loadServer(serverId)
    const { testServerBackupCapabilities } = await import('@/lib/ssh')
    const result = await testServerBackupCapabilities(server)
    return jsonResult({
      serverId,
      serverName: server.name,
      ...result,
    })
  }).catch((error) =>
    errorResult(error instanceof Error ? error.message : 'Failed to test server')
  )
}

export async function testDatabaseOp(ctx: McpOpsContext, input: unknown) {
  return audited(ctx.actor, 'test_database', undefined, async () => {
    const data = databaseConnectionTestSchema.parse(input)
    const conn = connectionFromConfig({
      dbEngine: data.dbEngine,
      dbClient: data.dbClient,
      dbContainer: data.dbContainer,
      dbHost: data.dbHost,
      dbPort: data.dbPort,
      dbUser: data.dbUser,
      dbPassword: data.dbPassword,
      sourcePath: data.sourcePath,
    })

    if (data.sourceKind === 'local') {
      const result = await testDatabaseConnectionLocal(conn)
      return jsonResult({ success: true, sourceKind: 'local', result: result.stdout })
    }

    const server = await loadServer(data.serverId!)
    const ssh = await connectToServer(server)
    try {
      const result = await testDatabaseConnectionRemote(ssh, conn)
      return jsonResult({
        success: true,
        sourceKind: 'server',
        serverId: server.id,
        serverName: server.name,
        result: result.stdout,
      })
    } finally {
      ssh.dispose()
    }
  }).catch((error) =>
    errorResult(error instanceof Error ? error.message : 'Database connection test failed')
  )
}
