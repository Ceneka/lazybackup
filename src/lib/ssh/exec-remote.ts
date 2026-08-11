import { formatPreBackupCommandLog } from '@/lib/backup/log-format'
import { db } from '@/lib/db'
import { servers } from '@/lib/db/schema'
import { connectToServer } from '@/lib/ssh'
import { eq } from 'drizzle-orm'

const MAX_COMMAND_LENGTH = 8_000
const DEFAULT_TIMEOUT_MS = 120_000
const OUTPUT_TRUNCATE = 16_000

export type ExecRemoteCommandResult = {
  serverId: string
  serverName: string
  command: string
  exitCode: number | null
  stdout: string
  stderr: string
  truncated: boolean
  log: string
}

function truncateOutput(value: string, max = OUTPUT_TRUNCATE): {
  text: string
  truncated: boolean
} {
  if (value.length <= max) return { text: value, truncated: false }
  return {
    text: `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`,
    truncated: true,
  }
}

/**
 * Run a single shell command on a configured SSH server.
 * Requires caller to enforce remote_exec permission.
 */
export async function execRemoteCommand(
  serverId: string,
  command: string,
  options?: { timeoutMs?: number }
): Promise<ExecRemoteCommandResult> {
  const trimmed = command.trim()
  if (!trimmed) {
    throw new Error('Command is required')
  }
  if (trimmed.length > MAX_COMMAND_LENGTH) {
    throw new Error(`Command exceeds ${MAX_COMMAND_LENGTH} characters`)
  }

  const server = await db.query.servers.findFirst({
    where: eq(servers.id, serverId),
  })
  if (!server) {
    throw new Error(`Server not found: ${serverId}`)
  }

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const ssh = await connectToServer(server)
  try {
    const result = await ssh.execCommand(trimmed, {
      execOptions: { timeout: timeoutMs },
    })
    const stdout = truncateOutput(result.stdout ?? '')
    const stderr = truncateOutput(result.stderr ?? '')
    const exitCode = result.code ?? null
    const log = formatPreBackupCommandLog(trimmed, {
      stdout: stdout.text,
      stderr: stderr.text,
      code: exitCode,
    })

    return {
      serverId: server.id,
      serverName: server.name,
      command: trimmed,
      exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      truncated: stdout.truncated || stderr.truncated,
      log,
    }
  } finally {
    ssh.dispose()
  }
}
