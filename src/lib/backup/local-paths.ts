import * as os from 'os';
import * as path from 'path';

/** Reject control characters that break argv/shell and enable smuggling. */
export function assertSafePathString(value: string, label = 'Path'): string {
  if (!value) {
    throw new Error(`${label} is required`);
  }
  if (/[\r\n\0]/.test(value)) {
    throw new Error(`${label} contains invalid characters`);
  }
  return value;
}

export function expandLocalPath(dest: string): string {
  assertSafePathString(dest, 'Path');
  let expanded = dest;
  if (expanded.startsWith('~')) {
    expanded = expanded.replace(/^~(?=\/|$)/, process.env.HOME || os.homedir());
  }
  return path.resolve(expanded);
}

export function isPathInside(parent: string, child: string): boolean {
  const root = path.resolve(parent);
  const target = path.resolve(child);
  return target === root || target.startsWith(root + path.sep);
}

/**
 * Resolve a relative (possibly nested) path under rootDir.
 * Rejects absolute segments, `..`, and NUL/newlines. Does not follow symlinks.
 */
export function confineRelativePath(rootDir: string, relativePath: string): string {
  assertSafePathString(relativePath, 'Path');
  const rel = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel) {
    throw new Error('Invalid path');
  }
  const segments = rel.split('/').filter((s) => s && s !== '.');
  if (segments.length === 0) {
    throw new Error('Invalid path');
  }
  if (segments.some((s) => s === '..' || s === '' || path.isAbsolute(s))) {
    throw new Error('Path traversal is not allowed');
  }
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, ...segments);
  if (!isPathInside(root, resolved)) {
    throw new Error('Path escapes destination directory');
  }
  return resolved;
}

export function allowArbitraryLocalPaths(): boolean {
  return process.env.ALLOW_ARBITRARY_LOCAL_PATHS === 'true';
}

/**
 * Directories treated as the local backup storage root.
 * Docker bind-mounts the same host dir at `/backups` and `/app/backups`.
 */
export function getAllowedLocalStorageRoots(
  envPath = process.env.BACKUP_STORAGE_PATH
): string[] {
  const raw = (envPath || './backups').trim() || './backups';
  const expanded = raw.startsWith('~')
    ? raw.replace(/^~(?=\/|$)/, process.env.HOME || os.homedir())
    : raw;
  const resolved = path.resolve(expanded);
  const roots = new Set<string>([resolved]);
  if (
    resolved === '/backups' ||
    resolved === '/app/backups' ||
    raw === './backups' ||
    raw === 'backups'
  ) {
    roots.add('/backups');
    roots.add('/app/backups');
  }
  return [...roots];
}

export function isUnderBackupStoragePath(resolvedPath: string): boolean {
  const target = path.resolve(resolvedPath);
  return getAllowedLocalStorageRoots().some((root) => isPathInside(root, target));
}

/**
 * Local destinations must resolve inside BACKUP_STORAGE_PATH unless
 * ALLOW_ARBITRARY_LOCAL_PATHS=true. `..` and newlines are always rejected.
 */
export function assertLocalDestinationPath(dest: string): string {
  const resolved = expandLocalPath(dest);
  if (dest.split(/[/\\]/).includes('..') && !isUnderBackupStoragePath(resolved)) {
    throw new Error('Local destination path traversal is not allowed');
  }
  if (!allowArbitraryLocalPaths() && !isUnderBackupStoragePath(resolved)) {
    const roots = getAllowedLocalStorageRoots();
    throw new Error(
      `Local destination must be under BACKUP_STORAGE_PATH (${roots[0]}). Set ALLOW_ARBITRARY_LOCAL_PATHS=true to override.`
    );
  }
  return resolved;
}

/** Local sources may be anywhere, but must not smuggle newlines or escape via unexpanded `..` tricks. */
export function assertLocalSourcePath(src: string): string {
  return expandLocalPath(src);
}

/**
 * Paths a restore must never write to: they are the running system, the
 * instance's own state, or backup storage. Restoring onto these is always a
 * mistake and, on a bad day, unrecoverable.
 */
const FORBIDDEN_RESTORE_TARGETS = [
  '/',
  '/dev',
  '/proc',
  '/sys',
  '/boot',
  '/run',
  '/var/lib/docker',
];

function instanceDataDir(): string | null {
  const raw = (process.env.DATABASE_URL || '').trim();
  if (!raw.startsWith('file:')) return null;
  const dbFile = raw.slice('file:'.length).trim();
  if (!dbFile || dbFile === ':memory:') return null;
  return path.dirname(path.resolve(dbFile));
}

/**
 * Validate a local restore destination. Restores intentionally may land
 * outside BACKUP_STORAGE_PATH (they usually target the original source), but
 * never on the running system, the instance's own data, or backup storage.
 * `ALLOW_ARBITRARY_LOCAL_PATHS` does not override this: it widens *backup*
 * destinations, not restores.
 */
export function assertRestorableLocalTarget(
  dest: string,
  options: { protectedPaths?: Array<string | null | undefined> } = {}
): string {
  const resolved = expandLocalPath(dest);
  const forbidden = new Set(FORBIDDEN_RESTORE_TARGETS);
  // Exact match only: restoring *into* a storage root would mix restored files
  // with every backup, but a subfolder (e.g. /backups/restores/x in Docker,
  // where /backups is often the only host mount) is a legitimate target.
  const exactOnly = new Set<string>();

  // The instance data directory is treated like a storage root: the directory
  // itself (and anything containing it) is refused, a subfolder is fine — it
  // cannot overwrite the database next to it. The database files themselves
  // are always refused.
  const dataDir = instanceDataDir();
  if (dataDir && dataDir !== '/') exactOnly.add(dataDir);

  const dbFile = (process.env.DATABASE_URL || '').trim().replace(/^file:/, '');
  if (dbFile && dbFile !== ':memory:') {
    const dbPath = path.resolve(dbFile);
    for (const suffix of ['', '-wal', '-shm', '-journal']) forbidden.add(dbPath + suffix);
  }

  for (const root of getAllowedLocalStorageRoots()) {
    exactOnly.add(root);
  }

  // The backup's own destination (where the artifact being restored lives).
  for (const raw of options.protectedPaths || []) {
    if (raw && raw.trim()) forbidden.add(expandLocalPath(raw));
  }

  const home = process.env.HOME || os.homedir();
  if (home) forbidden.add(path.join(home, '.ssh'));

  if (exactOnly.has(resolved)) {
    throw new Error(
      `Refusing to restore onto ${resolved}: this is the backup storage root or the LazyBackup data directory. Choose a subfolder or a different target.`
    );
  }

  for (const root of exactOnly) {
    // A target that *contains* the storage root can receive `<root>/...` from
    // the restored tree and overwrite the backups themselves.
    if (isPathInside(resolved, root)) {
      throw new Error(
        `Refusing to restore onto ${resolved}: it contains backup storage or LazyBackup's own data (${root}). Choose a subfolder or a different target.`
      );
    }
  }

  for (const blocked of forbidden) {
    const matches =
      resolved === blocked ||
      // Writing into the protected tree.
      (blocked !== '/' && isPathInside(blocked, resolved)) ||
      // Writing over the protected tree: the copied files can contain paths
      // that land inside it (e.g. target=$HOME restores .ssh/authorized_keys).
      isPathInside(resolved, blocked);
    if (matches) {
      throw new Error(
        `Refusing to restore onto ${resolved}: this path holds the running system, the LazyBackup instance's own data, or backup storage. Choose a different target.`
      );
    }
  }

  return resolved;
}

