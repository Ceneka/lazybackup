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
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
  '/usr',
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
export function assertRestorableLocalTarget(dest: string): string {
  const resolved = expandLocalPath(dest);
  const forbidden = new Set(FORBIDDEN_RESTORE_TARGETS);

  const dataDir = instanceDataDir();
  if (dataDir && dataDir !== '/') forbidden.add(dataDir);

  const dbFile = (process.env.DATABASE_URL || '').trim().replace(/^file:/, '');
  if (dbFile && dbFile !== ':memory:') {
    forbidden.add(path.resolve(dbFile));
  }

  for (const root of getAllowedLocalStorageRoots()) {
    forbidden.add(root);
  }

  const home = process.env.HOME || os.homedir();
  if (home) forbidden.add(path.join(home, '.ssh'));

  for (const blocked of forbidden) {
    const matches =
      resolved === blocked ||
      (blocked !== '/' && isPathInside(blocked, resolved));
    if (matches) {
      throw new Error(
        `Refusing to restore onto ${resolved}: this path holds the running system, the LazyBackup instance's own data, or backup storage. Choose a different target.`
      );
    }
  }

  return resolved;
}

