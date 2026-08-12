/** Opt-in API token capabilities (session / unlocked always have all). */
export const API_TOKEN_PERMISSIONS = ['remote_exec'] as const

export type ApiTokenPermission = (typeof API_TOKEN_PERMISSIONS)[number]

export type AuthPermissionView = {
  authorized: boolean
  via: 'unlocked' | 'session' | 'bearer' | 'none'
  apiToken?: { permissions: ApiTokenPermission[] }
}

export const REMOTE_EXEC_DENIED =
  'API token lacks remote_exec permission. Create a token with “Allow remote command execution” in Settings → API / MCP (or use a browser session).'

export function isApiTokenPermission(value: string): value is ApiTokenPermission {
  return (API_TOKEN_PERMISSIONS as readonly string[]).includes(value)
}

/** Parse JSON array stored on api_tokens.permissions; unknown entries ignored. */
export function parseApiTokenPermissions(
  raw: string | null | undefined
): ApiTokenPermission[] {
  if (!raw || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const out: ApiTokenPermission[] = []
    for (const item of parsed) {
      if (typeof item === 'string' && isApiTokenPermission(item) && !out.includes(item)) {
        out.push(item)
      }
    }
    return out
  } catch {
    return []
  }
}

export function serializeApiTokenPermissions(
  permissions: readonly ApiTokenPermission[]
): string {
  const unique = [...new Set(permissions.filter(isApiTokenPermission))]
  return JSON.stringify(unique)
}

export function normalizeApiTokenPermissionsInput(
  input: unknown
): ApiTokenPermission[] {
  if (input == null) return []
  if (!Array.isArray(input)) {
    throw new Error('permissions must be an array')
  }
  const out: ApiTokenPermission[] = []
  for (const item of input) {
    if (typeof item !== 'string' || !isApiTokenPermission(item)) {
      throw new Error(`Unknown permission: ${String(item)}`)
    }
    if (!out.includes(item)) out.push(item)
  }
  return out
}

/**
 * Session and unlocked modes are full operator.
 * Bearer tokens only get explicitly granted permissions.
 */
export function authHasPermission(
  auth: AuthPermissionView,
  permission: ApiTokenPermission
): boolean {
  if (!auth.authorized) return false
  if (auth.via === 'session' || auth.via === 'unlocked') return true
  if (auth.via === 'bearer') {
    return Boolean(auth.apiToken?.permissions.includes(permission))
  }
  return false
}

export function authAllowsRemoteExec(auth: AuthPermissionView): boolean {
  return authHasPermission(auth, 'remote_exec')
}

/** Who may set an app password: browser session or unlocked first-run. */
export function allowsPasswordSet(via: AuthPermissionView['via']): boolean {
  return via === 'session' || via === 'unlocked'
}

/**
 * Setting or changing non-empty pre-backup commands is remote execution.
 * Clearing commands, or leaving them unchanged, does not require remote_exec.
 */
export function preBackupChangeRequiresRemoteExec(
  incoming: string | null | undefined,
  existing?: string | null
): boolean {
  const next = (incoming ?? '').trim()
  if (!next) return false
  const prev = (existing ?? '').trim()
  return next !== prev
}

export function assertCanSetPreBackupCommands(
  auth: AuthPermissionView,
  incoming: string | null | undefined,
  existing?: string | null
): void {
  if (!preBackupChangeRequiresRemoteExec(incoming, existing)) return
  if (!authAllowsRemoteExec(auth)) {
    throw new RemoteExecPermissionError()
  }
}

export class RemoteExecPermissionError extends Error {
  readonly status = 403

  constructor(message = REMOTE_EXEC_DENIED) {
    super(message)
    this.name = 'RemoteExecPermissionError'
  }
}
