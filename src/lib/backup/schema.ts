import { MIN_WRAP_PASSPHRASE_LENGTH } from '@/lib/crypto/constants';
import { getNextCronDate } from '@/lib/cron/next';
import { DOCKER_VOLUME_NAME_RE } from '@/lib/docker/volumes';
import { assertValidSqlitePath } from '@/lib/database';
import { z } from 'zod';

/** Database name: alphanumeric start, then alnum / _ $ - */
export const DB_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_$-]*$/;

export const dbEngineSchema = z.enum(['postgres', 'mysql', 'mariadb', 'sqlite']);
export const dbClientSchema = z.enum(['native', 'docker']);
export const endpointKindSchema = z.enum(['local', 'server', 's3', 'peer']);

export const CRON_VALIDATION_MESSAGE =
  'Invalid cron expression — use 5 fields (minute hour day month weekday)';

/** True for a parseable 5-field cron expression (the scheduler's format). */
export function isValidCronExpression(expression: string): boolean {
  const trimmed = expression.trim();
  if (!trimmed || trimmed.split(/\s+/).length !== 5) return false;
  return getNextCronDate(trimmed) !== null;
}

/**
 * Base field map shared by create (POST) and update (PUT). Update semantics
 * differ only in defaults: an omitted key must stay omitted so the route can
 * keep the stored value, while create still materializes full defaults.
 */
const backupConfigFields = {
  name: z.string().min(1, 'Name is required'),
  sourceKind: z.enum(['local', 'server', 's3', 'git']),
  /** Source server when sourceKind === 'server' (legacy field name) */
  serverId: z.string().nullable().optional(),
  sourceS3ProfileId: z.string().nullable().optional(),
  sourceGitRepoId: z.string().nullable().optional(),
  destinationKind: endpointKindSchema,
  destinationServerId: z.string().nullable().optional(),
  destinationS3ProfileId: z.string().nullable().optional(),
  destinationPeerId: z.string().nullable().optional(),
  sourceType: z.enum([
    'path',
    'docker_volume',
    'database',
    'lazybackup_instance',
    'git_repo',
  ]),
  sourcePath: z.string(),
  destinationPath: z.string().min(1, 'Destination path is required'),
  schedule: z
    .string()
    .min(1, 'Schedule is required')
    .refine(isValidCronExpression, { message: CRON_VALIDATION_MESSAGE }),
  // GET returns null for unset fields; the form sends null when a field is
  // cleared. null = clear explicitly, undefined = field omitted (keep stored).
  excludePatterns: z.string().nullable().optional(),
  preBackupCommands: z.string().nullable().optional(),
  dbEngine: dbEngineSchema.nullable().optional(),
  dbClient: dbClientSchema.nullable().optional(),
  dbContainer: z.string().nullable().optional(),
  dbHost: z.string().nullable().optional(),
  dbPort: z
    .preprocess(
      (v) => (v === null || v === undefined || v === '' ? null : v),
      z.coerce.number().int().min(1).max(65535).nullable()
    )
    .optional(),
  dbUser: z.string().nullable().optional(),
  dbPassword: z.string().nullable().optional(),
  /** Optional age passphrase wrap for lazybackup_instance (not instance age keys) */
  instanceBackupPassphrase: z.string().nullable().optional(),
  enabled: z.boolean(),
  enableEncryption: z.boolean(),
  /** rsync --delete for unencrypted path transfers (ignored for S3/peer/archives) */
  deleteExtraneous: z.boolean(),
  enableVersioning: z.boolean(),
  versionsToKeep: z.coerce.number().min(1).max(100).nullable().optional(),
  enableFileRetention: z.boolean(),
  retentionMaxAge: z.coerce.number().min(1).max(3650).nullable().optional(),
  retentionMaxAgeUnit: z.enum(['days', 'months']).nullable().optional(),
  retentionMinKeep: z.coerce.number().min(1).max(10000).nullable().optional(),
};

const backupConfigObjectSchema = z.object({
  ...backupConfigFields,
  sourceKind: backupConfigFields.sourceKind.default('server'),
  destinationKind: backupConfigFields.destinationKind.default('local'),
  sourceType: backupConfigFields.sourceType.default('path'),
  sourcePath: backupConfigFields.sourcePath.default(''),
  enabled: backupConfigFields.enabled.default(true),
  enableEncryption: backupConfigFields.enableEncryption.default(false),
  deleteExtraneous: backupConfigFields.deleteExtraneous.default(false),
  enableVersioning: backupConfigFields.enableVersioning.default(false),
  versionsToKeep: backupConfigFields.versionsToKeep.default(5),
  enableFileRetention: backupConfigFields.enableFileRetention.default(false),
  retentionMaxAge: backupConfigFields.retentionMaxAge.default(30),
  retentionMaxAgeUnit: backupConfigFields.retentionMaxAgeUnit.default('days'),
  retentionMinKeep: backupConfigFields.retentionMinKeep.default(5),
});

export const backupConfigSchema = backupConfigObjectSchema
  .superRefine((data, ctx) => {
    if (data.sourceType !== 'lazybackup_instance' && data.sourceType !== 'git_repo' && !data.sourcePath.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Source path is required',
        path: ['sourcePath'],
      });
    }

    if (data.sourceKind === 'server') {
      if (!data.serverId || !data.serverId.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Source server is required',
          path: ['serverId'],
        });
      }
    }

    if (data.sourceKind === 's3') {
      if (!data.sourceS3ProfileId || !data.sourceS3ProfileId.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Source S3 profile is required',
          path: ['sourceS3ProfileId'],
        });
      }
      if (data.sourceType !== 'path') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'S3 sources only support filesystem path (object prefix) backups',
          path: ['sourceType'],
        });
      }
    }

    if (data.sourceKind === 'git') {
      if (!data.sourceGitRepoId || !data.sourceGitRepoId.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Git repository is required',
          path: ['sourceGitRepoId'],
        });
      }
      if (data.sourceType !== 'git_repo') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Git sources only support Git repository (bare mirror) backups',
          path: ['sourceType'],
        });
      }
    }

    if (data.sourceType === 'git_repo' && data.sourceKind !== 'git') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Git repository backups require a Git source',
        path: ['sourceKind'],
      });
    }

    if (data.destinationKind === 'server') {
      if (!data.destinationServerId || !data.destinationServerId.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Destination server is required',
          path: ['destinationServerId'],
        });
      }
    }

    if (data.destinationKind === 's3') {
      if (!data.destinationS3ProfileId || !data.destinationS3ProfileId.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Destination S3 profile is required',
          path: ['destinationS3ProfileId'],
        });
      }
    }

    if (data.destinationKind === 'peer') {
      if (!data.destinationPeerId || !data.destinationPeerId.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Bro peer is required',
          path: ['destinationPeerId'],
        });
      }
    }

    if (data.sourceType === 'docker_volume' && data.sourceKind !== 'server' && data.sourceKind !== 'local') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Docker volume sources require this host or a source server',
        path: ['sourceType'],
      });
    }

    if (data.sourceType === 'docker_volume' && !DOCKER_VOLUME_NAME_RE.test(data.sourcePath)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Invalid Docker volume name. Names must start with a letter or digit and contain only letters, digits, underscore, period, or hyphen.',
        path: ['sourcePath'],
      });
    }

    if (data.sourceType === 'lazybackup_instance') {
      if (data.sourceKind !== 'local') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'LazyBackup instance backup requires a local source',
          path: ['sourceKind'],
        });
      }
      const passphrase = data.instanceBackupPassphrase?.trim();
      if (passphrase && passphrase.length < MIN_WRAP_PASSPHRASE_LENGTH) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Passphrase must be at least ${MIN_WRAP_PASSPHRASE_LENGTH} characters`,
          path: ['instanceBackupPassphrase'],
        });
      }
      if (data.destinationKind === 'peer') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Instance backups cannot use Bro destinations (use passphrase wrap or a trusted path/S3/server)',
          path: ['destinationKind'],
        });
      }
    }

    if (data.sourceType === 'database') {
      if (data.sourceKind === 's3') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Database dumps cannot use an S3 source',
          path: ['sourceType'],
        });
      }
      if (!data.dbEngine) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Database engine is required',
          path: ['dbEngine'],
        });
      }
      const isSqlite = data.dbEngine === 'sqlite';
      if (isSqlite) {
        if (data.dbClient === 'docker') {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'SQLite dumps are native-only (no docker client)',
            path: ['dbClient'],
          });
        }
        try {
          assertValidSqlitePath(data.sourcePath);
        } catch (error) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: error instanceof Error ? error.message : 'Invalid SQLite path',
            path: ['sourcePath'],
          });
        }
      } else {
      if (!data.dbClient) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Database client mode is required',
          path: ['dbClient'],
        });
      }
      if (!data.dbUser || !data.dbUser.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Database user is required',
          path: ['dbUser'],
        });
      }
      if (!DB_NAME_RE.test(data.sourcePath)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            'Invalid database name. Names must start with a letter or digit and contain only letters, digits, underscore, dollar, or hyphen.',
          path: ['sourcePath'],
        });
      }
      if (data.dbClient === 'docker') {
        const container = data.dbContainer?.trim();
        if (!container) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Container name is required for docker client mode',
            path: ['dbContainer'],
          });
        } else if (!DOCKER_VOLUME_NAME_RE.test(container)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Invalid Docker container name',
            path: ['dbContainer'],
          });
        }
      }
      }
    }

    if (data.enableVersioning && data.enableFileRetention) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'File retention cannot be enabled together with versioning',
        path: ['enableFileRetention'],
      });
    }

    if (data.sourceType === 'path' || data.sourceType === 'docker_volume') {
      const sameServer =
        data.sourceKind === 'server' &&
        data.destinationKind === 'server' &&
        data.serverId &&
        data.destinationServerId &&
        data.serverId === data.destinationServerId;
      const bothLocal = data.sourceKind === 'local' && data.destinationKind === 'local';
      const sameS3 =
        data.sourceKind === 's3' &&
        data.destinationKind === 's3' &&
        data.sourceS3ProfileId &&
        data.destinationS3ProfileId &&
        data.sourceS3ProfileId === data.destinationS3ProfileId;
      if (
        (sameServer || bothLocal || sameS3) &&
        data.sourcePath.trim() === data.destinationPath.trim()
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Source and destination cannot be the same path on the same endpoint',
          path: ['destinationPath'],
        });
      }
    }
  })
  .transform((data) => {
    const isDatabase = data.sourceType === 'database';
    const isInstance = data.sourceType === 'lazybackup_instance';
    const isGit = data.sourceType === 'git_repo' || data.sourceKind === 'git';
    const isPeer = data.destinationKind === 'peer';
    const enableEncryption = isInstance
      ? false
      : isPeer
        ? true
        : Boolean(data.enableEncryption);
    const deleteExtraneous =
      data.sourceType === 'path' &&
      data.sourceKind !== 's3' &&
      data.sourceKind !== 'git' &&
      data.destinationKind !== 's3' &&
      data.destinationKind !== 'peer' &&
      !enableEncryption &&
      Boolean(data.deleteExtraneous);
    return {
      ...data,
      sourceKind: isInstance ? ('local' as const) : isGit ? ('git' as const) : data.sourceKind,
      sourcePath: isInstance ? 'lazybackup-instance' : isGit ? 'git-mirror' : data.sourcePath,
      serverId: isInstance || isGit
        ? null
        : data.sourceKind === 'server'
          ? data.serverId || null
          : null,
      sourceS3ProfileId: isInstance || isGit
        ? null
        : data.sourceKind === 's3'
          ? data.sourceS3ProfileId || null
          : null,
      sourceGitRepoId: isGit ? data.sourceGitRepoId || null : null,
      destinationServerId: data.destinationKind === 'server' ? data.destinationServerId || null : null,
      destinationS3ProfileId:
        data.destinationKind === 's3' ? data.destinationS3ProfileId || null : null,
      destinationPeerId: isPeer ? data.destinationPeerId || null : null,
      // Instance archives use optional passphrase, never instance age keys / Bro encrypt
      enableEncryption,
      deleteExtraneous,
      instanceBackupPassphrase: isInstance
        ? data.instanceBackupPassphrase ?? null
        : null,
      dbEngine: isDatabase ? data.dbEngine ?? null : null,
      dbClient: isDatabase
        ? data.dbEngine === 'sqlite'
          ? ('native' as const)
          : data.dbClient ?? null
        : null,
      dbContainer:
        isDatabase && data.dbEngine !== 'sqlite' && data.dbClient === 'docker'
          ? data.dbContainer?.trim() || null
          : null,
      dbHost:
        isDatabase && data.dbEngine !== 'sqlite' ? data.dbHost?.trim() || '127.0.0.1' : null,
      dbPort: isDatabase && data.dbEngine !== 'sqlite' ? data.dbPort ?? null : null,
      dbUser: isDatabase && data.dbEngine !== 'sqlite' ? data.dbUser?.trim() || null : null,
      dbPassword: isDatabase && data.dbEngine !== 'sqlite' ? data.dbPassword ?? '' : null,
      // Keep undefined (keep stored on update) distinct from null (clear). A
      // concrete value on a source type that cannot use it becomes a clear so
      // a type switch never leaves a stale command/pattern behind.
      preBackupCommands: isInstance || isGit
        ? data.preBackupCommands === undefined
          ? undefined
          : null
        : data.preBackupCommands,
      excludePatterns: isInstance || isDatabase || isGit
        ? data.excludePatterns === undefined
          ? undefined
          : null
        : data.excludePatterns,
    };
  });

/**
 * Update (PUT) input: every field is optional and nullable so an omitted key
 * can keep the stored value while an explicit null clears it. Defaults are not
 * materialized here — that is what used to reset omitted fields on every PUT.
 * The update helper maps null on NOT NULL boolean columns to their default.
 */
export const backupConfigUpdateSchema = z
  .object({
    ...backupConfigFields,
    enabled: z.boolean().nullable(),
    enableEncryption: z.boolean().nullable(),
    deleteExtraneous: z.boolean().nullable(),
    enableVersioning: z.boolean().nullable(),
    enableFileRetention: z.boolean().nullable(),
  })
  .partial();

export type BackupConfigValues = z.output<typeof backupConfigSchema>;
export type BackupConfigUpdateInput = z.input<typeof backupConfigUpdateSchema>;
export type ParsedBackupConfigUpdate = z.output<typeof backupConfigUpdateSchema>;

/** Body for POST /api/backups/database/test */
export const databaseConnectionTestSchema = z
  .object({
    sourceKind: z.enum(['local', 'server']).default('local'),
    serverId: z.string().nullable().optional(),
    dbEngine: dbEngineSchema,
    dbClient: dbClientSchema,
    dbContainer: z.string().nullable().optional(),
    dbHost: z.string().nullable().optional(),
    dbPort: z
      .preprocess(
        (v) => (v === null || v === undefined || v === '' ? null : v),
        z.coerce.number().int().min(1).max(65535).nullable()
      )
      .optional(),
    dbUser: z.string().optional(),
    dbPassword: z.string().nullable().optional(),
    /** Database name, or filesystem path when dbEngine=sqlite */
    sourcePath: z.string().min(1, 'Database name is required'),
  })
  .superRefine((data, ctx) => {
    if (data.sourceKind === 'server' && (!data.serverId || !data.serverId.trim())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Source server is required',
        path: ['serverId'],
      });
    }
    if (data.dbEngine === 'sqlite') {
      if (data.dbClient === 'docker') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SQLite dumps are native-only (no docker client)',
          path: ['dbClient'],
        });
      }
      try {
        assertValidSqlitePath(data.sourcePath);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof Error ? error.message : 'Invalid SQLite path',
          path: ['sourcePath'],
        });
      }
      return;
    }
    if (!data.dbUser || !data.dbUser.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Database user is required',
        path: ['dbUser'],
      });
    }
    if (!DB_NAME_RE.test(data.sourcePath)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Invalid database name',
        path: ['sourcePath'],
      });
    }
    if (data.dbClient === 'docker') {
      const container = data.dbContainer?.trim();
      if (!container) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Container name is required for docker client mode',
          path: ['dbContainer'],
        });
      }
    }
  })
  .transform((data) => ({
    ...data,
    serverId: data.sourceKind === 'server' ? data.serverId || null : null,
    dbContainer: data.dbClient === 'docker' ? data.dbContainer?.trim() || null : null,
    dbHost: data.dbHost?.trim() || '127.0.0.1',
    dbPassword: data.dbPassword ?? '',
  }));
