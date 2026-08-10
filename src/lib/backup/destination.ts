export type DestinationConfigRef = {
  id: string;
  name: string;
  destinationPath: string;
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
  serverName: string;
  backupName: string;
  storageRoot?: string;
}): string {
  const root = (options.storageRoot ?? getSuggestStorageRoot()).replace(/\/+$/, '') || '/backups';
  const serverSlug = slugifyName(options.serverName || 'server');
  const backupSlug = slugifyName(options.backupName || 'backup');
  return `${root}/${serverSlug}/${backupSlug}`;
}

/** Normalized key for comparing destinations (resolved + no trailing slash). */
export function destinationCompareKey(destinationPath: string): string {
  return resolveLocalBackupPath(destinationPath);
}

export function destinationsAreSame(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) {
    return false;
  }
  return destinationCompareKey(a) === destinationCompareKey(b);
}

/**
 * True if one resolved path is a parent of the other (not the same path).
 */
export function destinationsNest(a: string, b: string): boolean {
  if (!a.trim() || !b.trim()) {
    return false;
  }
  const left = destinationCompareKey(a);
  const right = destinationCompareKey(b);
  if (left === right) {
    return false;
  }
  const leftFs = left.endsWith('/') ? left : `${left}/`;
  const rightFs = right.endsWith('/') ? right : `${right}/`;
  return right.startsWith(leftFs) || left.startsWith(rightFs);
}

export function findExactConflictInList(
  configs: DestinationConfigRef[],
  destinationPath: string,
  excludeConfigId?: string
): DestinationConflict | null {
  if (!destinationPath.trim()) {
    return null;
  }
  const target = destinationCompareKey(destinationPath);
  for (const config of configs) {
    if (excludeConfigId && config.id === excludeConfigId) {
      continue;
    }
    if (destinationCompareKey(config.destinationPath) === target) {
      return { id: config.id, name: config.name };
    }
  }
  return null;
}

export function findNestedOverlapsInList(
  configs: DestinationConfigRef[],
  destinationPath: string,
  excludeConfigId?: string
): DestinationConflict[] {
  if (!destinationPath.trim()) {
    return [];
  }
  const overlaps: DestinationConflict[] = [];
  for (const config of configs) {
    if (excludeConfigId && config.id === excludeConfigId) {
      continue;
    }
    if (destinationsNest(destinationPath, config.destinationPath)) {
      overlaps.push({ id: config.id, name: config.name });
    }
  }
  return overlaps;
}
