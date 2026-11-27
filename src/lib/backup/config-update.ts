import { inArray } from 'drizzle-orm';
import { backupConfigs, gitRepos, peers, s3Profiles, servers } from '@/lib/db/schema';
import {
  backupConfigSchema,
  type BackupConfigValues,
  type ParsedBackupConfigUpdate,
} from './schema';

export type BackupConfigRow = typeof backupConfigs.$inferSelect;

export type BackupConfigReferenceIssue = {
  path: string[];
  message: string;
};

/** 400-shaped error for ids that point at rows that do not exist. */
export class BackupConfigReferenceError extends Error {
  readonly issues: BackupConfigReferenceIssue[];

  constructor(issues: BackupConfigReferenceIssue[]) {
    super('Validation error');
    this.name = 'BackupConfigReferenceError';
    this.issues = issues;
  }
}

type BackupConfigWritableKey = Exclude<
  keyof BackupConfigRow,
  | 'id'
  | 'createdAt'
  | 'updatedAt'
  | 'lastValidatedAt'
  | 'lastValidationOk'
  | 'lastValidationChecks'
>;

export type BackupConfigUpdatePatch = Partial<
  Pick<BackupConfigRow, BackupConfigWritableKey>
>;

/** Columns that are NOT NULL: null resets them to their documented default. */
const BOOLEAN_DEFAULTS = {
  enabled: true,
  enableEncryption: false,
  deleteExtraneous: false,
  enableVersioning: false,
  enableFileRetention: false,
} as const satisfies Partial<Record<keyof BackupConfigRow, boolean>>;

/** Normalized when the source endpoint/type changes so no old id or db field leaks. */
const SOURCE_CLEANUP_KEYS = [
  'sourceKind',
  'sourcePath',
  'serverId',
  'sourceS3ProfileId',
  'sourceGitRepoId',
] as const;

const DATABASE_CLEANUP_KEYS = [
  'dbEngine',
  'dbClient',
  'dbContainer',
  'dbHost',
  'dbPort',
  'dbUser',
] as const;

const DESTINATION_CLEANUP_KEYS = [
  'destinationServerId',
  'destinationS3ProfileId',
  'destinationPeerId',
] as const;

function resolveSecret(
  incoming: string | null | undefined,
  stored: string | null,
  applies: boolean
): string | null {
  // The column does not apply to the (new) source type: never keep a secret.
  if (!applies) return null;
  if (incoming === null) return null;
  // undefined = omitted (MCP/partial update); empty or whitespace = the edit
  // form's "leave blank to keep the stored secret".
  if (incoming === undefined) return stored;
  return incoming.trim() ? incoming : stored;
}

/**
 * Merge a partial PUT body over the stored row and return both the validated
 * candidate (for auth/conflict/reference checks) and the column patch.
 *
 * - omitted key  -> not in the patch (stored value survives)
 * - null         -> NULL for nullable columns, documented default otherwise
 * - value        -> validated value
 *
 * Derived fields (ids, db settings, encryption/--delete flags) are normalized
 * when their controlling source/destination field is part of the update, so a
 * type switch cannot leave a dangling peer/server id or a stale secret.
 */
export function buildBackupConfigUpdate(
  existing: BackupConfigRow,
  input: ParsedBackupConfigUpdate
): { candidate: BackupConfigValues; update: BackupConfigUpdatePatch } {
  const overrides: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    overrides[key] =
      value === null && key in BOOLEAN_DEFAULTS
        ? BOOLEAN_DEFAULTS[key as keyof typeof BOOLEAN_DEFAULTS]
        : value;
  }

  const candidate = backupConfigSchema.parse({ ...existing, ...overrides });
  const normalized = candidate as unknown as Record<string, unknown>;

  const update: Record<string, unknown> = {};
  for (const key of Object.keys(overrides)) {
    update[key] = normalized[key];
  }

  const sourceTypeTouched = input.sourceType !== undefined;
  const sourceKindTouched = input.sourceKind !== undefined;
  const destinationKindTouched = input.destinationKind !== undefined;

  if (sourceTypeTouched || sourceKindTouched) {
    for (const key of SOURCE_CLEANUP_KEYS) update[key] = normalized[key];
  }

  if (sourceTypeTouched) {
    for (const key of DATABASE_CLEANUP_KEYS) update[key] = normalized[key];
  }

  if (destinationKindTouched) {
    for (const key of DESTINATION_CLEANUP_KEYS) update[key] = normalized[key];
  }

  if (
    sourceTypeTouched ||
    sourceKindTouched ||
    destinationKindTouched ||
    input.enableEncryption !== undefined
  ) {
    update.enableEncryption = candidate.enableEncryption;
    update.deleteExtraneous = candidate.deleteExtraneous;
  }

  update.dbPassword = resolveSecret(
    input.dbPassword,
    existing.dbPassword,
    candidate.sourceType === 'database' && candidate.dbEngine !== 'sqlite'
  );
  update.instanceBackupPassphrase = resolveSecret(
    input.instanceBackupPassphrase,
    existing.instanceBackupPassphrase,
    candidate.sourceType === 'lazybackup_instance'
  );

  return { candidate, update: update as BackupConfigUpdatePatch };
}

export type BackupReferenceCheck = {
  path: string[];
  id: string;
  message: string;
};

/** Pure list of endpoint references that must exist for this config. */
export function collectBackupConfigReferenceChecks(config: {
  serverId?: string | null;
  sourceS3ProfileId?: string | null;
  sourceGitRepoId?: string | null;
  destinationServerId?: string | null;
  destinationS3ProfileId?: string | null;
  destinationPeerId?: string | null;
}): BackupReferenceCheck[] {
  const checks: BackupReferenceCheck[] = [];
  const add = (path: string, id: string | null | undefined, message: string) => {
    if (id && id.trim()) checks.push({ path: [path], id, message });
  };

  add('serverId', config.serverId, 'Server not found');
  add('sourceS3ProfileId', config.sourceS3ProfileId, 'S3 profile not found');
  add('sourceGitRepoId', config.sourceGitRepoId, 'Git repository not found');
  add('destinationServerId', config.destinationServerId, 'Server not found');
  add('destinationS3ProfileId', config.destinationS3ProfileId, 'S3 profile not found');
  add('destinationPeerId', config.destinationPeerId, 'Bro peer not found');
  return checks;
}

/**
 * Resolve the referenced servers / S3 profiles / Git repos / peers and report
 * the ones that are missing, with Zod-style `{ path, message }` issues.
 */
export async function findBackupConfigReferenceIssues(config: {
  serverId?: string | null;
  sourceS3ProfileId?: string | null;
  sourceGitRepoId?: string | null;
  destinationServerId?: string | null;
  destinationS3ProfileId?: string | null;
  destinationPeerId?: string | null;
}): Promise<BackupConfigReferenceIssue[]> {
  const checks = collectBackupConfigReferenceChecks(config);
  if (checks.length === 0) return [];

  const idsFor = (path: string) =>
    checks.filter((check) => check.path[0] === path).map((check) => check.id);
  const serverIds = idsFor('serverId').concat(idsFor('destinationServerId'));
  const s3ProfileIds = idsFor('sourceS3ProfileId').concat(idsFor('destinationS3ProfileId'));
  const gitRepoIds = idsFor('sourceGitRepoId');
  const peerIds = idsFor('destinationPeerId');

  const { db } = await import('@/lib/db');
  const [serverRows, s3Rows, gitRows, peerRows] = await Promise.all([
    serverIds.length
      ? db.select({ id: servers.id }).from(servers).where(inArray(servers.id, serverIds))
      : Promise.resolve([] as { id: string }[]),
    s3ProfileIds.length
      ? db
          .select({ id: s3Profiles.id })
          .from(s3Profiles)
          .where(inArray(s3Profiles.id, s3ProfileIds))
      : Promise.resolve([] as { id: string }[]),
    gitRepoIds.length
      ? db.select({ id: gitRepos.id }).from(gitRepos).where(inArray(gitRepos.id, gitRepoIds))
      : Promise.resolve([] as { id: string }[]),
    peerIds.length
      ? db.select({ id: peers.id }).from(peers).where(inArray(peers.id, peerIds))
      : Promise.resolve([] as { id: string }[]),
  ]);

  const existing = {
    server: new Set(serverRows.map((row) => row.id)),
    s3: new Set(s3Rows.map((row) => row.id)),
    git: new Set(gitRows.map((row) => row.id)),
    peer: new Set(peerRows.map((row) => row.id)),
  };

  const issues: BackupConfigReferenceIssue[] = [];
  const check = (
    path: string,
    id: string | null | undefined,
    found: Set<string>,
    message: string
  ) => {
    if (id && id.trim() && !found.has(id)) issues.push({ path: [path], message });
  };

  check('serverId', config.serverId, existing.server, 'Server not found');
  check('sourceS3ProfileId', config.sourceS3ProfileId, existing.s3, 'S3 profile not found');
  check(
    'sourceGitRepoId',
    config.sourceGitRepoId,
    existing.git,
    'Git repository not found'
  );
  check(
    'destinationServerId',
    config.destinationServerId,
    existing.server,
    'Server not found'
  );
  check(
    'destinationS3ProfileId',
    config.destinationS3ProfileId,
    existing.s3,
    'S3 profile not found'
  );
  check(
    'destinationPeerId',
    config.destinationPeerId,
    existing.peer,
    'Bro peer not found'
  );

  return issues;
}

export async function assertBackupConfigReferences(config: {
  serverId?: string | null;
  sourceS3ProfileId?: string | null;
  sourceGitRepoId?: string | null;
  destinationServerId?: string | null;
  destinationS3ProfileId?: string | null;
  destinationPeerId?: string | null;
}): Promise<void> {
  const issues = await findBackupConfigReferenceIssues(config);
  if (issues.length > 0) throw new BackupConfigReferenceError(issues);
}
