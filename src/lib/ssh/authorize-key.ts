import { createHash } from 'crypto'
import { eq } from 'drizzle-orm'
import { db } from '../db'
import { servers } from '../db/schema'
import { connectToServer } from './index'

/**
 * Install (or remove) a caller's OpenSSH public key in a server's
 * `~/.ssh/authorized_keys`, using the credentials LazyBackup already holds.
 * Lets clients such as sshya reach linked servers with their own key, so the
 * private keys in the vault never leave this instance.
 */

const PUBLIC_KEY_TYPES = new Set([
  'ssh-ed25519',
  'ssh-rsa',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
  'sk-ssh-ed25519@openssh.com',
  'sk-ecdsa-sha2-nistp256@openssh.com',
])

const MAX_PUBLIC_KEY_LENGTH = 8_192
const COMMENT_PATTERN = /^[A-Za-z0-9@._:+-]{1,100}$/
const BLOB_PATTERN = /^[A-Za-z0-9+/]+={0,3}$/
const DEFAULT_TIMEOUT_MS = 30_000

export type ParsedPublicKey = {
  type: string
  blob: string
  comment?: string
  /** `type blob [comment]`, safe to embed in a double-quoted shell word. */
  line: string
  /** OpenSSH-style `SHA256:…` fingerprint (as `ssh-keygen -lf` prints it). */
  fingerprint: string
}

export class InvalidPublicKeyError extends Error {
  readonly status = 400

  constructor(message: string) {
    super(message)
    this.name = 'InvalidPublicKeyError'
  }
}

/**
 * Accept exactly one plain OpenSSH public key line. Options (`command=…`,
 * `from=…`) and unusual comment characters are refused: the key is the only
 * thing a caller may add, and the strict alphabet keeps the remote script free
 * of shell metacharacters.
 */
export function parsePublicKey(input: string): ParsedPublicKey {
  const text = input.trim()
  if (!text) {
    throw new InvalidPublicKeyError('publicKey is required')
  }
  if (text.length > MAX_PUBLIC_KEY_LENGTH) {
    throw new InvalidPublicKeyError(`publicKey exceeds ${MAX_PUBLIC_KEY_LENGTH} characters`)
  }
  if (/[\r\n]/.test(text)) {
    throw new InvalidPublicKeyError('publicKey must be a single line')
  }
  const parts = text.split(/[ \t]+/)
  if (parts.length < 2 || parts.length > 3) {
    throw new InvalidPublicKeyError('publicKey must look like "<type> <base64> [comment]"')
  }
  const [type, blob, comment] = parts
  if (!PUBLIC_KEY_TYPES.has(type)) {
    throw new InvalidPublicKeyError(`Unsupported key type: ${type.slice(0, 40)}`)
  }
  if (!BLOB_PATTERN.test(blob)) {
    throw new InvalidPublicKeyError('publicKey data is not base64')
  }
  const bytes = Buffer.from(blob, 'base64')
  // The blob starts with its own type as an SSH string: uint32 length + bytes.
  const declaredLength = bytes.length >= 4 ? bytes.readUInt32BE(0) : -1
  const declaredType =
    declaredLength > 0 && declaredLength + 4 <= bytes.length
      ? bytes.subarray(4, 4 + declaredLength).toString('latin1')
      : ''
  if (declaredType !== type) {
    throw new InvalidPublicKeyError('publicKey data does not match its type')
  }
  if (comment !== undefined && !COMMENT_PATTERN.test(comment)) {
    throw new InvalidPublicKeyError(
      'publicKey comment may only use letters, digits, and @ . _ : + - (max 100)'
    )
  }
  const fingerprint = `SHA256:${createHash('sha256').update(bytes).digest('base64').replace(/=+$/, '')}`
  return {
    type,
    blob,
    ...(comment ? { comment } : {}),
    line: comment ? `${type} ${blob} ${comment}` : `${type} ${blob}`,
    fingerprint,
  }
}

/**
 * POSIX sh script, run as `sh -c '<script>'` so the login shell (bash, zsh,
 * fish) only has to parse one single-quoted word. It must not contain single
 * quotes; the key alphabet guarantees that for the interpolated parts.
 * Prints `added` or `present`.
 */
export function buildAuthorizeScript(key: ParsedPublicKey): string {
  return [
    'umask 077',
    'd="$HOME/.ssh"; f="$d/authorized_keys"',
    `k="${key.type} ${key.blob}"`,
    'mkdir -p "$d" || exit 1',
    'if [ -f "$f" ] && grep -qF -- "$k" "$f"; then echo present; exit 0; fi',
    // Never glue the new key onto a last line without a trailing newline.
    'if [ -s "$f" ] && [ -n "$(tail -c 1 "$f")" ]; then echo >> "$f" || exit 1; fi',
    `echo "${key.line}" >> "$f" || exit 1`,
    'command -v restorecon >/dev/null 2>&1 && restorecon -R "$d" >/dev/null 2>&1',
    'echo added',
  ].join('\n')
}

/** Removes every line carrying the key (any options/comment). Prints `removed` or `absent`. */
export function buildRevokeScript(key: ParsedPublicKey): string {
  return [
    'umask 077',
    'f="$HOME/.ssh/authorized_keys"',
    `k="${key.type} ${key.blob}"`,
    'if [ ! -f "$f" ] || ! grep -qF -- "$k" "$f"; then echo absent; exit 0; fi',
    't="$f.lazybackup.$$"',
    'grep -vF -- "$k" "$f" > "$t"',
    // Rewrite in place so the file keeps its inode, owner, mode, and SELinux label.
    'cat "$t" > "$f" || { rm -f "$t"; exit 1; }',
    'rm -f "$t"',
    'echo removed',
  ].join('\n')
}

export function wrapForLoginShell(script: string): string {
  if (script.includes("'")) {
    throw new Error('authorize-key script must not contain single quotes')
  }
  return `sh -c '${script}'`
}

export type AuthorizeKeyAction = 'authorize' | 'revoke'

export type AuthorizeKeyResult = {
  serverId: string
  serverName: string
  fingerprint: string
  /** authorize: added | present; revoke: removed | absent */
  status: 'added' | 'present' | 'removed' | 'absent'
}

export async function updateAuthorizedKeyOnServer(
  serverId: string,
  publicKey: string,
  action: AuthorizeKeyAction,
  options?: { timeoutMs?: number }
): Promise<AuthorizeKeyResult> {
  const key = parsePublicKey(publicKey)
  const server = await db.query.servers.findFirst({
    where: eq(servers.id, serverId),
  })
  if (!server) {
    throw new Error(`Server not found: ${serverId}`)
  }

  const script = action === 'authorize' ? buildAuthorizeScript(key) : buildRevokeScript(key)
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const ssh = await connectToServer(server)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      ssh.execCommand(wrapForLoginShell(script)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      }),
    ])
    const status = (result.stdout ?? '').trim().split('\n').pop()?.trim()
    const expected = action === 'authorize' ? ['added', 'present'] : ['removed', 'absent']
    if (result.code !== 0 || !status || !expected.includes(status)) {
      const detail = (result.stderr || result.stdout || '').trim().slice(0, 500)
      throw new Error(
        `Could not update authorized_keys on ${server.name} (exit ${result.code ?? '?'})${detail ? `: ${detail}` : ''}`
      )
    }
    return {
      serverId: server.id,
      serverName: server.name,
      fingerprint: key.fingerprint,
      status: status as AuthorizeKeyResult['status'],
    }
  } finally {
    if (timer) clearTimeout(timer)
    ssh.dispose()
  }
}
