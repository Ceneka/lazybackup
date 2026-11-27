/**
 * Restore-relevant snapshot of a backup config, captured on the history row at
 * run start. Restores use these values (not the live config) so editing a
 * backup after it ran cannot silently redirect an old restore.
 *
 * No secrets are stored: credentials/profile keys stay in their own tables and
 * are looked up by the snapshotted ids.
 */

export type RestoreSnapshotSourceKind = 'local' | 'server' | 's3' | 'git';
export type RestoreSnapshotDestinationKind = 'local' | 'server' | 's3' | 'peer';
export type RestoreSnapshotSourceType =
  | 'path'
  | 'docker_volume'
  | 'database'
  | 'lazybackup_instance'
  | 'git_repo';

export type RestoreConfigSnapshot = {
  version: 1;
  capturedAt: string;
  sourceKind: RestoreSnapshotSourceKind;
  sourceType: RestoreSnapshotSourceType;
  serverId: string | null;
  sourceS3ProfileId: string | null;
  sourceGitRepoId: string | null;
  sourcePath: string;
  dbEngine: string | null;
  /** Database name (same as sourcePath for database backups). */
  dbName: string | null;
  /**
   * Where the dump came from (not the password, which stays live). Optional:
   * snapshots written before these fields existed fall back to the live config.
   */
  dbHost?: string | null;
  dbPort?: number | null;
  dbUser?: string | null;
  dbClient?: string | null;
  dbContainer?: string | null;
  /** Docker volume name (same as sourcePath for volume backups). */
  volumeName: string | null;
  destinationKind: RestoreSnapshotDestinationKind;
  destinationServerId: string | null;
  destinationS3ProfileId: string | null;
  destinationPeerId: string | null;
  destinationPath: string;
  enableEncryption: boolean;
  enableVersioning: boolean;
};

export type RestoreSnapshotConfigLike = {
  sourceKind?: string | null;
  sourceType?: string | null;
  serverId?: string | null;
  sourceS3ProfileId?: string | null;
  sourceGitRepoId?: string | null;
  sourcePath: string;
  dbEngine?: string | null;
  dbHost?: string | null;
  dbPort?: number | null;
  dbUser?: string | null;
  dbClient?: string | null;
  dbContainer?: string | null;
  destinationKind?: string | null;
  destinationServerId?: string | null;
  destinationS3ProfileId?: string | null;
  destinationPeerId?: string | null;
  destinationPath: string;
  enableEncryption?: boolean | null;
  enableVersioning?: boolean | null;
};

function normalizeSourceKind(value: string | null | undefined): RestoreSnapshotSourceKind {
  return value === 'local' || value === 's3' || value === 'git' ? value : 'server';
}

function normalizeDestinationKind(
  value: string | null | undefined
): RestoreSnapshotDestinationKind {
  return value === 'server' || value === 's3' || value === 'peer' ? value : 'local';
}

function normalizeSourceType(value: string | null | undefined): RestoreSnapshotSourceType {
  return value === 'docker_volume' ||
    value === 'database' ||
    value === 'lazybackup_instance' ||
    value === 'git_repo'
    ? value
    : 'path';
}

function idOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildRestoreSnapshot(
  config: RestoreSnapshotConfigLike,
  options: { capturedAt?: Date } = {}
): RestoreConfigSnapshot {
  const sourceType = normalizeSourceType(config.sourceType);
  const sourcePath = config.sourcePath ?? '';
  return {
    version: 1,
    capturedAt: (options.capturedAt ?? new Date()).toISOString(),
    sourceKind: normalizeSourceKind(config.sourceKind),
    sourceType,
    serverId: idOrNull(config.serverId),
    sourceS3ProfileId: idOrNull(config.sourceS3ProfileId),
    sourceGitRepoId: idOrNull(config.sourceGitRepoId),
    sourcePath,
    dbEngine: sourceType === 'database' ? config.dbEngine ?? null : null,
    dbName: sourceType === 'database' ? sourcePath : null,
    dbHost: sourceType === 'database' ? config.dbHost ?? null : null,
    dbPort: sourceType === 'database' ? config.dbPort ?? null : null,
    dbUser: sourceType === 'database' ? config.dbUser ?? null : null,
    dbClient: sourceType === 'database' ? config.dbClient ?? null : null,
    dbContainer: sourceType === 'database' ? config.dbContainer ?? null : null,
    volumeName: sourceType === 'docker_volume' ? sourcePath : null,
    destinationKind: normalizeDestinationKind(config.destinationKind),
    destinationServerId: idOrNull(config.destinationServerId),
    destinationS3ProfileId: idOrNull(config.destinationS3ProfileId),
    destinationPeerId: idOrNull(config.destinationPeerId),
    destinationPath: config.destinationPath ?? '',
    enableEncryption: Boolean(config.enableEncryption),
    enableVersioning: Boolean(config.enableVersioning),
  };
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Parse a stored snapshot; unknown/old shapes fall back to the live config. */
export function parseRestoreSnapshot(value: unknown): RestoreConfigSnapshot | null {
  let raw: unknown = value;
  if (typeof value === 'string') {
    if (!value.trim()) return null;
    try {
      raw = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) return null;
  if (typeof obj.sourcePath !== 'string' || typeof obj.destinationPath !== 'string') {
    return null;
  }

  return {
    version: 1,
    capturedAt:
      typeof obj.capturedAt === 'string' ? obj.capturedAt : new Date(0).toISOString(),
    sourceKind: normalizeSourceKind(asStringOrNull(obj.sourceKind)),
    sourceType: normalizeSourceType(asStringOrNull(obj.sourceType)),
    serverId: asStringOrNull(obj.serverId),
    sourceS3ProfileId: asStringOrNull(obj.sourceS3ProfileId),
    sourceGitRepoId: asStringOrNull(obj.sourceGitRepoId),
    sourcePath: obj.sourcePath,
    dbEngine: asStringOrNull(obj.dbEngine),
    dbName: asStringOrNull(obj.dbName),
    ...(Object.prototype.hasOwnProperty.call(obj, 'dbHost')
      ? {
          dbHost: asStringOrNull(obj.dbHost),
          dbPort: typeof obj.dbPort === 'number' ? obj.dbPort : null,
          dbUser: asStringOrNull(obj.dbUser),
          dbClient: asStringOrNull(obj.dbClient),
          dbContainer: asStringOrNull(obj.dbContainer),
        }
      : {}),
    volumeName: asStringOrNull(obj.volumeName),
    destinationKind: normalizeDestinationKind(asStringOrNull(obj.destinationKind)),
    destinationServerId: asStringOrNull(obj.destinationServerId),
    destinationS3ProfileId: asStringOrNull(obj.destinationS3ProfileId),
    destinationPeerId: asStringOrNull(obj.destinationPeerId),
    destinationPath: obj.destinationPath,
    enableEncryption: obj.enableEncryption === true,
    enableVersioning: obj.enableVersioning === true,
  };
}

export type EffectiveRestoreConfig = {
  snapshot: RestoreConfigSnapshot | null;
  sourceKind: RestoreSnapshotSourceKind;
  sourceType: RestoreSnapshotSourceType;
  serverId: string | null;
  sourceS3ProfileId: string | null;
  sourceGitRepoId: string | null;
  sourcePath: string;
  dbEngine: string | null;
  dbName: string | null;
  /** Dump origin; from the snapshot when it recorded them, else the live config. */
  dbHost: string | null;
  dbPort: number | null;
  dbUser: string | null;
  dbClient: string | null;
  dbContainer: string | null;
  volumeName: string | null;
  destinationKind: RestoreSnapshotDestinationKind;
  destinationServerId: string | null;
  destinationS3ProfileId: string | null;
  destinationPeerId: string | null;
  destinationPath: string;
  enableEncryption: boolean;
  enableVersioning: boolean;
};

/**
 * Restore values for a run: the snapshot when present, otherwise the live
 * config (legacy rows created before snapshots existed).
 */
export function effectiveRestoreConfig(
  snapshot: RestoreConfigSnapshot | null,
  config: RestoreSnapshotConfigLike
): EffectiveRestoreConfig {
  const live = buildRestoreSnapshot(config);
  const source = snapshot ?? live;
  return {
    snapshot,
    sourceKind: source.sourceKind,
    sourceType: source.sourceType,
    serverId: source.serverId,
    sourceS3ProfileId: source.sourceS3ProfileId,
    sourceGitRepoId: source.sourceGitRepoId,
    sourcePath: source.sourcePath,
    dbEngine: source.dbEngine,
    dbName: source.dbName,
    dbHost: source.dbHost !== undefined ? source.dbHost : live.dbHost ?? null,
    dbPort: source.dbPort !== undefined ? source.dbPort : live.dbPort ?? null,
    dbUser: source.dbUser !== undefined ? source.dbUser : live.dbUser ?? null,
    dbClient: source.dbClient !== undefined ? source.dbClient : live.dbClient ?? null,
    dbContainer:
      source.dbContainer !== undefined ? source.dbContainer : live.dbContainer ?? null,
    volumeName: source.volumeName,
    destinationKind: source.destinationKind,
    destinationServerId: source.destinationServerId,
    destinationS3ProfileId: source.destinationS3ProfileId,
    destinationPeerId: source.destinationPeerId,
    destinationPath: source.destinationPath,
    enableEncryption: source.enableEncryption,
    enableVersioning: source.enableVersioning,
  };
}

/** Whether restore-relevant config fields were edited after this run. */
export function snapshotDiffersFromConfig(
  snapshot: RestoreConfigSnapshot,
  config: RestoreSnapshotConfigLike
): boolean {
  const live = buildRestoreSnapshot(config);
  return (
    snapshot.sourceKind !== live.sourceKind ||
    snapshot.sourceType !== live.sourceType ||
    snapshot.serverId !== live.serverId ||
    snapshot.sourceS3ProfileId !== live.sourceS3ProfileId ||
    snapshot.sourceGitRepoId !== live.sourceGitRepoId ||
    snapshot.sourcePath !== live.sourcePath ||
    snapshot.dbEngine !== live.dbEngine ||
    snapshot.dbName !== live.dbName ||
    (snapshot.dbHost !== undefined &&
      (snapshot.dbHost !== live.dbHost ||
        snapshot.dbPort !== live.dbPort ||
        snapshot.dbUser !== live.dbUser ||
        snapshot.dbClient !== live.dbClient ||
        snapshot.dbContainer !== live.dbContainer)) ||
    snapshot.volumeName !== live.volumeName ||
    snapshot.destinationKind !== live.destinationKind ||
    snapshot.destinationServerId !== live.destinationServerId ||
    snapshot.destinationS3ProfileId !== live.destinationS3ProfileId ||
    snapshot.destinationPeerId !== live.destinationPeerId ||
    snapshot.destinationPath !== live.destinationPath ||
    snapshot.enableEncryption !== live.enableEncryption ||
    snapshot.enableVersioning !== live.enableVersioning
  );
}

/** Contract C5: defaults for the restore form, derived from the run snapshot. */
export type RestoreDefaults = {
  targetPath: string | null;
  targetServerId: string | null;
  databaseName: string | null;
  volumeName: string | null;
  configChangedSinceRun: boolean;
};

export function restoreDefaultsFromSnapshot(
  snapshot: RestoreConfigSnapshot | null,
  config: RestoreSnapshotConfigLike
): RestoreDefaults | null {
  if (!snapshot) return null;
  return {
    targetPath:
      snapshot.sourceType === 'path' && snapshot.sourceKind !== 'git'
        ? snapshot.sourcePath
        : null,
    targetServerId: snapshot.sourceKind === 'server' ? snapshot.serverId : null,
    databaseName: snapshot.sourceType === 'database' ? snapshot.dbName : null,
    volumeName: snapshot.sourceType === 'docker_volume' ? snapshot.volumeName : null,
    configChangedSinceRun: snapshotDiffersFromConfig(snapshot, config),
  };
}
