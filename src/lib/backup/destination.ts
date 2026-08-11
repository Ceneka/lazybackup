export type EndpointKind = 'local' | 'server' | 's3';

export type DestinationConfigRef = {
  id: string;
  name: string;
  destinationPath: string;
  destinationKind?: EndpointKind | null;
  destinationServerId?: string | null;
  destinationS3ProfileId?: string | null;
};

export type DestinationConflict = {
  id: string;
  name: string;
};

/**
 * Expand ~ and resolve relative paths the same way backup execution does.
 * Avoids Node-only imports so forms can reuse these helpers in the browser.
 */
export function resolveLocalBackupPath(destinationPath: string): string {
  let resolved = destinationPath.trim();

  if (resolved.startsWith('~')) {
    const home =
      typeof process !== 'undefined' && process.env.HOME
        ? process.env.HOME
        : '';
    if (home) {
      resolved = resolved.replace(/^~(?=\/|$)/, home);
    }
  }

  const isAbsolute =
    resolved.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(resolved);

  if (!isAbsolute && typeof process !== 'undefined' && typeof process.cwd === 'function') {
    const cwd = process.cwd().replace(/[/\\]+$/, '');
    resolved = `${cwd}/${resolved}`.replace(/\\/g, '/').replace(/\/+/g, '/');
  }

  return resolved.replace(/[/\\]+$/, '') || (resolved.startsWith('/') ? '/' : resolved);
}

/** Normalize a remote filesystem path for comparison (trim, collapse trailing slashes). */
export function normalizeRemotePath(remotePath: string): string {
  const trimmed = remotePath.trim().replace(/\\/g, '/');
  if (!trimmed || trimmed === '/') {
    return '/';
  }
  return trimmed.replace(/\/+$/, '');
}

/** Normalize an S3 object key prefix (no leading slash; trailing slash stripped). */
export function normalizeS3Prefix(prefix: string): string {
  return prefix
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');
}

/**
 * Slug for path segments: lowercase, non-alnum → `-`, collapse/trim dashes.
 */
export function slugifyName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'backup';
}

/**
 * Root used when suggesting destinations.
 * Relative default (`./backups`) maps to `/backups` (Docker/README convention).
 */
export function getSuggestStorageRoot(
  envPath = typeof process !== 'undefined' ? process.env.BACKUP_STORAGE_PATH : undefined
): string {
  const raw = (envPath || './backups').trim();
  if (raw === './backups' || raw === 'backups' || raw === '.') {
    return '/backups';
  }
  if (raw.startsWith('/')) {
    return raw.replace(/\/+$/, '') || '/backups';
  }
  // Other relative / ~ paths: stable absolute UI default under /backups
  return '/backups';
}

export function suggestDestinationPath(options: {
  serverName?: string;
  backupName: string;
  storageRoot?: string;
}): string {
  const root = (options.storageRoot ?? getSuggestStorageRoot()).replace(/\/+$/, '') || '/backups';
  const serverSlug = slugifyName(options.serverName || 'local');
  const backupSlug = slugifyName(options.backupName || 'backup');
  return `${root}/${serverSlug}/${backupSlug}`;
}

/** Normalized key for comparing local destinations (resolved + no trailing slash). */
export function destinationCompareKey(destinationPath: string): string {
  return resolveLocalBackupPath(destinationPath);
}

/**
 * Unique key for a destination endpoint (local path, remote server+path, or S3 profile+prefix).
 */
export function destinationEndpointKey(options: {
  destinationKind?: EndpointKind | null;
  destinationServerId?: string | null;
  destinationS3ProfileId?: string | null;
  destinationPath: string;
}): string {
  const kind = options.destinationKind || 'local';
  if (kind === 'server') {
    const serverId = options.destinationServerId || '';
    return `server:${serverId}:${normalizeRemotePath(options.destinationPath)}`;
  }
  if (kind === 's3') {
    const profileId = options.destinationS3ProfileId || '';
    return `s3:${profileId}:${normalizeS3Prefix(options.destinationPath)}`;
  }
  return `local:${destinationCompareKey(options.destinationPath)}`;
}

export function destinationsAreSame(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) {
    return false;
  }
  return destinationCompareKey(a) === destinationCompareKey(b);
}

/** True if one absolute/normalized path is a parent of the other (not the same). */
export function pathsNest(left: string, right: string): boolean {
  if (!left || !right || left === right) {
    return false;
  }
  const leftFs = left.endsWith('/') ? left : `${left}/`;
  const rightFs = right.endsWith('/') ? right : `${right}/`;
  return right.startsWith(leftFs) || left.startsWith(rightFs);
}

/**
 * True if one resolved local path is a parent of the other (not the same path).
 */
export function destinationsNest(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) {
    return false;
  }
  return pathsNest(destinationCompareKey(a), destinationCompareKey(b));
}

function sameDestinationEndpoint(
  a: DestinationConfigRef,
  b: {
    destinationKind?: EndpointKind | null;
    destinationServerId?: string | null;
    destinationS3ProfileId?: string | null;
    destinationPath: string;
  }
): boolean {
  return (
    destinationEndpointKey({
      destinationKind: a.destinationKind,
      destinationServerId: a.destinationServerId,
      destinationS3ProfileId: a.destinationS3ProfileId,
      destinationPath: a.destinationPath,
    }) ===
    destinationEndpointKey({
      destinationKind: b.destinationKind,
      destinationServerId: b.destinationServerId,
      destinationS3ProfileId: b.destinationS3ProfileId,
      destinationPath: b.destinationPath,
    })
  );
}

export function findExactConflictInList(
  configs: DestinationConfigRef[],
  destinationPath: string,
  excludeConfigId?: string,
  options?: {
    destinationKind?: EndpointKind | null;
    destinationServerId?: string | null;
    destinationS3ProfileId?: string | null;
  }
): DestinationConflict | null {
  if (!destinationPath.trim()) {
    return null;
  }
  const target = {
    destinationKind: options?.destinationKind || 'local',
    destinationServerId: options?.destinationServerId ?? null,
    destinationS3ProfileId: options?.destinationS3ProfileId ?? null,
    destinationPath,
  };
  for (const config of configs) {
    if (excludeConfigId && config.id === excludeConfigId) {
      continue;
    }
    if (sameDestinationEndpoint(config, target)) {
      return { id: config.id, name: config.name };
    }
  }
  return null;
}

export function findNestedOverlapsInList(
  configs: DestinationConfigRef[],
  destinationPath: string,
  excludeConfigId?: string,
  options?: {
    destinationKind?: EndpointKind | null;
    destinationServerId?: string | null;
    destinationS3ProfileId?: string | null;
  }
): DestinationConflict[] {
  if (!destinationPath.trim()) {
    return [];
  }
  const targetKind = options?.destinationKind || 'local';
  const targetServerId = options?.destinationServerId ?? null;
  const targetS3Id = options?.destinationS3ProfileId ?? null;

  // Nesting only applies to local destinations (or the same remote server / S3 profile).
  const overlaps: DestinationConflict[] = [];
  for (const config of configs) {
    if (excludeConfigId && config.id === excludeConfigId) {
      continue;
    }
    const configKind = config.destinationKind || 'local';
    if (configKind !== targetKind) {
      continue;
    }
    if (targetKind === 'server') {
      if ((config.destinationServerId || null) !== targetServerId) {
        continue;
      }
      if (pathsNest(normalizeRemotePath(destinationPath), normalizeRemotePath(config.destinationPath))) {
        overlaps.push({ id: config.id, name: config.name });
      }
      continue;
    }
    if (targetKind === 's3') {
      if ((config.destinationS3ProfileId || null) !== targetS3Id) {
        continue;
      }
      if (pathsNest(normalizeS3Prefix(destinationPath), normalizeS3Prefix(config.destinationPath))) {
        overlaps.push({ id: config.id, name: config.name });
      }
      continue;
    }
    if (destinationsNest(destinationPath, config.destinationPath)) {
      overlaps.push({ id: config.id, name: config.name });
    }
  }
  return overlaps;
}
