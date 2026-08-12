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
