export type RetentionAgeUnit = 'days' | 'months';

export type FileCandidate = {
  name: string;
  mtimeMs: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Archives LazyBackup lands: dumps, volume tars, instance packs, optional .age wrap. */
export const BACKUP_ARTIFACT_NAME_RE = /\.(tar\.gz|sql\.gz)(\.age)?$/i;

export function isBackupArtifactFileName(name: string): boolean {
  const base = name.split(/[/\\]/).pop() || '';
  if (!base || base.startsWith('.') || base.includes('..')) return false;
  return BACKUP_ARTIFACT_NAME_RE.test(base);
}

export function maxAgeToMs(maxAge: number, unit: RetentionAgeUnit): number {
  if (unit === 'months') {
    return maxAge * 30 * DAY_MS;
  }
  return maxAge * DAY_MS;
}

/**
 * Returns names of top-level files that should be deleted:
 * keep the newest `minKeep` files always; among the rest, delete those older than max age.
 */
export function selectFilesToDelete(
  files: FileCandidate[],
  options: {
    maxAge: number;
    unit: RetentionAgeUnit;
    minKeep: number;
    nowMs?: number;
  }
): string[] {
  const minKeep = Math.max(0, options.minKeep);
  const now = options.nowMs ?? Date.now();
  const cutoff = now - maxAgeToMs(options.maxAge, options.unit);

  const sortedNewestFirst = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const protectedNames = new Set(
    sortedNewestFirst.slice(0, minKeep).map((file) => file.name)
  );

  return sortedNewestFirst
    .filter((file) => !protectedNames.has(file.name) && file.mtimeMs < cutoff)
    .map((file) => file.name);
}

export type PeerObjectCandidate = {
  key: string;
  mtimeMs: number;
};

/** Timestamp version folder names: YYYY-MM-DD_HH-mm-ss */
export const PEER_VERSION_DIR_RE = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}$/;

export function relativeKeyUnderPrefix(key: string, prefix: string): string | null {
  const normalizedKey = key.replace(/^\/+/, '');
  const base = prefix.replace(/^\/+|\/+$/g, '');
  if (!base) return normalizedKey;
  if (normalizedKey === base) return '';
  if (normalizedKey.startsWith(`${base}/`)) return normalizedKey.slice(base.length + 1);
  return null;
}

/**
 * Age + min-keep retention for peer objects directly under a prefix
 * (same semantics as S3 dump-folder cleanup).
 */
export function selectPeerKeysForFileRetention(
  objects: PeerObjectCandidate[],
  prefix: string,
  options: {
    maxAge: number;
    unit: RetentionAgeUnit;
    minKeep: number;
    nowMs?: number;
  }
): string[] {
  const topLevel: Array<{ key: string; name: string; mtimeMs: number }> = [];
  for (const obj of objects) {
    const rel = relativeKeyUnderPrefix(obj.key, prefix);
    if (rel == null || rel.length === 0 || rel.includes('/')) continue;
    if (!isBackupArtifactFileName(rel)) continue;
    topLevel.push({ key: obj.key, name: rel, mtimeMs: obj.mtimeMs });
  }

  const toDeleteNames = new Set(
    selectFilesToDelete(
      topLevel.map((file) => ({ name: file.name, mtimeMs: file.mtimeMs })),
      options
    )
  );
  return topLevel.filter((file) => toDeleteNames.has(file.name)).map((file) => file.key);
}

/**
 * Keep newest N timestamp prefixes under `prefix`; return object keys in older versions
 * (same semantics as S3 version-prefix cleanup).
 */
export function selectPeerKeysForVersionRetention(
  objects: PeerObjectCandidate[],
  prefix: string,
  versionsToKeep: number
): string[] {
  const byVersion = new Map<string, { keys: string[]; lastModifiedMs: number }>();
  for (const obj of objects) {
    const rel = relativeKeyUnderPrefix(obj.key, prefix);
    if (rel == null || !rel.includes('/')) continue;
    const versionName = rel.slice(0, rel.indexOf('/'));
    if (!PEER_VERSION_DIR_RE.test(versionName)) continue;
    const group = byVersion.get(versionName) ?? { keys: [], lastModifiedMs: 0 };
    group.keys.push(obj.key);
    group.lastModifiedMs = Math.max(group.lastModifiedMs, obj.mtimeMs);
    byVersion.set(versionName, group);
  }

  const versions = [...byVersion.entries()].map(([name, group]) => ({
    name,
    keys: group.keys,
    lastModifiedMs: group.lastModifiedMs,
  }));
  if (versions.length <= versionsToKeep) return [];

  versions.sort((a, b) => {
    if (a.name !== b.name) return a.name.localeCompare(b.name);
    return a.lastModifiedMs - b.lastModifiedMs;
  });
  const toRemove = versions.slice(0, Math.max(0, versions.length - versionsToKeep));
  return toRemove.flatMap((version) => version.keys);
}
