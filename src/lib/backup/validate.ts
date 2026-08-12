import { normalizeS3Prefix } from '@/lib/backup/destination';
import type { BackupConfigWithEndpoints } from '@/lib/backup/index';
import {
  connectionFromConfig,
  testDatabaseConnectionLocal,
  testDatabaseConnectionRemote,
} from '@/lib/database';
import { testS3Connection, type S3ProfileConfig } from '@/lib/s3';
import { connectToServer, testServerBackupCapabilities } from '@/lib/ssh';
import { CronJob } from 'cron';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

export type ValidateCheckStatus = 'pass' | 'fail' | 'warn';

export type ValidateCheck = {
  id: string;
  label: string;
  status: ValidateCheckStatus;
  message: string;
};

export type ValidateBackupResult = {
  ok: boolean;
  checks: ValidateCheck[];
};

export type StoredValidation = {
  ok: boolean;
  at: string;
  checks: ValidateCheck[];
};

export function parseStoredValidationChecks(raw: string | null | undefined): ValidateCheck[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ValidateCheck[]) : [];
  } catch {
    return [];
  }
}

/** Shape stored validation columns for API responses. */
export function formatLastValidation(config: {
  lastValidatedAt?: Date | null;
  lastValidationOk?: boolean | null;
  lastValidationChecks?: string | null;
}): StoredValidation | null {
  if (!config.lastValidatedAt) return null;
  return {
    ok: Boolean(config.lastValidationOk),
    at:
      config.lastValidatedAt instanceof Date
        ? config.lastValidatedAt.toISOString()
        : new Date(config.lastValidatedAt).toISOString(),
    checks: parseStoredValidationChecks(config.lastValidationChecks),
  };
}

/** Replace raw validation columns with a nested `lastValidation` object. */
export function attachLastValidation<T extends Record<string, unknown>>(config: T) {
  const lastValidation = formatLastValidation({
    lastValidatedAt: config.lastValidatedAt as Date | null | undefined,
    lastValidationOk: config.lastValidationOk as boolean | null | undefined,
    lastValidationChecks: config.lastValidationChecks as string | null | undefined,
  });
  const copy = { ...config } as Record<string, unknown>;
  delete copy.lastValidatedAt;
  delete copy.lastValidationOk;
  delete copy.lastValidationChecks;
  copy.lastValidation = lastValidation;
  return copy as T & { lastValidation: StoredValidation | null };
}

function expandLocalPath(dest: string): string {
  if (dest.startsWith('~')) {
    return path.join(os.homedir(), dest.slice(1));
  }
  return dest;
}

function toS3ProfileConfig(row: {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean | null;
}): S3ProfileConfig {
  return {
    endpoint: row.endpoint,
    region: row.region,
    bucket: row.bucket,
    accessKeyId: row.accessKeyId,
    secretAccessKey: row.secretAccessKey,
    forcePathStyle: row.forcePathStyle ?? true,
  };
}

function normalizeServer(server: NonNullable<BackupConfigWithEndpoints['server']>) {
  return {
    ...server,
    password: server.password || null,
    privateKey: server.privateKey || null,
    sshKeyId: server.sshKeyId || null,
    systemKeyPath: server.systemKeyPath || null,
  };
}

function push(
  checks: ValidateCheck[],
  id: string,
  label: string,
  status: ValidateCheckStatus,
  message: string
) {
  checks.push({ id, label, status, message });
}

/**
 * Probe a backup config without transferring data or writing history.
 * May create local destination directories (mkdir) so the first real run can succeed.
 */
export async function validateBackupConfig(
  config: BackupConfigWithEndpoints
): Promise<ValidateBackupResult> {
  const checks: ValidateCheck[] = [];
  const sourceKind = config.sourceKind || 'server';
  const destinationKind = config.destinationKind || 'local';
  const sourceType = config.sourceType || 'path';

  // --- Static config ---
  try {
    if (sourceKind === 'server' && !config.server) {
      push(checks, 'config-source', 'Source endpoint', 'fail', 'Source server is missing');
    } else if (sourceKind === 's3' && !config.sourceS3Profile) {
      push(checks, 'config-source', 'Source endpoint', 'fail', 'Source S3 profile is missing');
    } else {
      push(checks, 'config-source', 'Source endpoint', 'pass', `Source kind: ${sourceKind}`);
    }

    if (destinationKind === 'server' && !config.destinationServer) {
      push(checks, 'config-dest', 'Destination endpoint', 'fail', 'Destination server is missing');
    } else if (destinationKind === 's3' && !config.destinationS3Profile) {
      push(
        checks,
        'config-dest',
        'Destination endpoint',
        'fail',
        'Destination S3 profile is missing'
      );
    } else if (destinationKind === 'peer' && !config.destinationPeer) {
      push(checks, 'config-dest', 'Destination endpoint', 'fail', 'Bro peer is missing');
    } else {
      push(
        checks,
        'config-dest',
        'Destination endpoint',
        'pass',
        `Destination kind: ${destinationKind}`
      );
    }

    if (config.enableEncryption || destinationKind === 'peer') {
      const { getEncryptionKeyStatus } = await import('@/lib/crypto/keys');
      const enc = await getEncryptionKeyStatus();
      if (!enc.configured) {
        push(
          checks,
          'config-encryption',
          'Encryption key',
          'fail',
          'Generate an age key in Settings → Encryption'
        );
      } else {
        push(checks, 'config-encryption', 'Encryption key', 'pass', 'age key configured');
      }
    }

    if (sourceType === 'lazybackup_instance') {
      if (sourceKind !== 'local') {
        push(
          checks,
          'config-source-type',
          'Source type',
          'fail',
          'Instance backups require a local source'
        );
      } else if (destinationKind === 'peer') {
        push(
          checks,
          'config-source-type',
          'Source type',
          'fail',
          'Instance backups cannot use Bro destinations'
        );
      } else {
        try {
          const { assertInstanceExportReadable } = await import(
            '@/lib/backup/instance-export'
          );
          const { dbPath } = await assertInstanceExportReadable();
          push(
            checks,
            'config-source-type',
            'Source type',
            'pass',
            `Instance export ready (${dbPath})`
          );
        } catch (error) {
          push(
            checks,
            'config-source-type',
            'Source type',
            'fail',
            error instanceof Error ? error.message : 'SQLite database not readable'
          );
        }
      }
    } else if (sourceType === 'docker_volume' && sourceKind !== 'server') {
      push(
        checks,
        'config-source-type',
        'Source type',
        'fail',
        'Docker volume backups require a source server'
      );
    } else if (sourceKind === 's3' && sourceType !== 'path') {
      push(
        checks,
        'config-source-type',
        'Source type',
        'fail',
        'S3 sources only support path (object prefix) backups'
      );
    } else {
      push(checks, 'config-source-type', 'Source type', 'pass', `sourceType=${sourceType}`);
    }
  } catch (error) {
    push(
      checks,
      'config',
      'Configuration',
      'fail',
      error instanceof Error ? error.message : 'Config check failed'
    );
  }

  // --- Schedule ---
  try {
    CronJob.from({ cronTime: config.schedule, onTick: () => {}, start: false });
    push(checks, 'schedule', 'Cron schedule', 'pass', `Valid expression: ${config.schedule}`);
  } catch (error) {
    push(
      checks,
      'schedule',
      'Cron schedule',
      'fail',
      error instanceof Error ? error.message : 'Invalid cron expression'
    );
  }

  // --- Source probes ---
  if (sourceKind === 'local' && sourceType === 'path') {
    const sourcePath = expandLocalPath(config.sourcePath);
    try {
      await fs.access(sourcePath);
      push(checks, 'source-path', 'Source path', 'pass', `Readable: ${sourcePath}`);
    } catch {
      push(checks, 'source-path', 'Source path', 'fail', `Not accessible: ${sourcePath}`);
    }
  }

  if (sourceKind === 'server' && config.server) {
    const result = await testServerBackupCapabilities(normalizeServer(config.server));
    if (!result.success) {
      push(
        checks,
        'source-ssh',
        'Source SSH',
        'fail',
        result.message || 'Could not connect to source server'
      );
    } else if (!result.rsyncAvailable && !result.scpAvailable) {
      push(
        checks,
        'source-ssh',
        'Source SSH',
        'fail',
        result.message || 'No rsync or scp available for transfers'
      );
    } else {
      push(
        checks,
        'source-ssh',
        'Source SSH',
        result.rsyncAvailable ? 'pass' : 'warn',
        result.message || 'Connected'
      );
    }

    if (sourceType === 'docker_volume') {
      if (result.success && result.dockerAvailable) {
        push(checks, 'source-docker', 'Docker on source', 'pass', 'Docker is available');
      } else if (result.success) {
        push(
          checks,
          'source-docker',
          'Docker on source',
          'fail',
          'Docker was not detected on the source server'
        );
      }
    }

    if (sourceType === 'path' && result.success) {
      const ssh = await connectToServer(normalizeServer(config.server)).catch(() => null);
      if (ssh) {
        try {
          const quoted = config.sourcePath.replace(/'/g, `'\\''`);
          const probe = await ssh.execCommand(`test -e '${quoted}'`);
          if (probe.code === 0) {
            push(
              checks,
              'source-remote-path',
              'Source path on server',
              'pass',
              `Exists: ${config.sourcePath}`
            );
          } else {
            push(
              checks,
              'source-remote-path',
              'Source path on server',
              'fail',
              `Not found: ${config.sourcePath}`
            );
          }
        } finally {
          ssh.dispose();
        }
      }
    }
  }

  if (sourceKind === 's3' && config.sourceS3Profile) {
    try {
      await testS3Connection(toS3ProfileConfig(config.sourceS3Profile));
      const prefix = normalizeS3Prefix(config.sourcePath);
      push(
        checks,
        'source-s3',
        'Source S3',
        'pass',
        `Connection OK (prefix: ${prefix || '(bucket root)'})`
      );
    } catch (error) {
      push(
        checks,
        'source-s3',
        'Source S3',
        'fail',
        error instanceof Error ? error.message : 'S3 source check failed'
      );
    }
  }

  if (sourceType === 'database') {
    try {
      const conn = connectionFromConfig({
        dbEngine: config.dbEngine,
        dbClient: config.dbClient,
        dbContainer: config.dbContainer,
        dbHost: config.dbHost,
        dbPort: config.dbPort,
        dbUser: config.dbUser,
        dbPassword: config.dbPassword,
        sourcePath: config.sourcePath,
      });
      if (sourceKind === 'local') {
        const result = await testDatabaseConnectionLocal(conn);
        push(
          checks,
          'source-db',
          'Database connection',
          'pass',
          result.stdout?.trim() || 'SELECT 1 OK'
        );
      } else if (config.server) {
        const ssh = await connectToServer(normalizeServer(config.server));
        try {
          const result = await testDatabaseConnectionRemote(ssh, conn);
          push(
            checks,
            'source-db',
            'Database connection',
            'pass',
            result.stdout?.trim() || 'SELECT 1 OK'
          );
        } finally {
          ssh.dispose();
        }
      }
    } catch (error) {
      push(
        checks,
        'source-db',
        'Database connection',
        'fail',
        error instanceof Error ? error.message : 'Database check failed'
      );
    }
  }

  // --- Destination probes ---
  if (destinationKind === 'local') {
    const dest = expandLocalPath(config.destinationPath);
    try {
      await fs.mkdir(dest, { recursive: true });
      await fs.access(dest);
      push(checks, 'dest-local', 'Local destination', 'pass', `Writable: ${dest}`);
    } catch (error) {
      push(
        checks,
        'dest-local',
        'Local destination',
        'fail',
        error instanceof Error ? error.message : `Cannot write to ${dest}`
      );
    }
  }

  if (destinationKind === 'server' && config.destinationServer) {
    const result = await testServerBackupCapabilities(
      normalizeServer(config.destinationServer)
    );
    if (!result.success) {
      push(
        checks,
        'dest-ssh',
        'Destination SSH',
        'fail',
        result.message || 'Could not connect to destination server'
      );
    } else if (!result.rsyncAvailable && !result.scpAvailable) {
      push(
        checks,
        'dest-ssh',
        'Destination SSH',
        'fail',
        result.message || 'No rsync or scp available on destination path'
      );
    } else {
      push(
        checks,
        'dest-ssh',
        'Destination SSH',
        result.rsyncAvailable ? 'pass' : 'warn',
        result.message || 'Connected'
      );
    }

    if (result.success) {
      const ssh = await connectToServer(normalizeServer(config.destinationServer)).catch(
        () => null
      );
      if (ssh) {
        try {
          const destPath = config.destinationPath.replace(/\/+$/, '') || config.destinationPath;
          const quoted = destPath.replace(/'/g, `'\\''`);
          const probe = await ssh.execCommand(
            `bash -lc 'p='"'"'${quoted}'"'"'; d=$(dirname "$p"); test -d "$p" || test -w "$d"'`
          );
          if (probe.code === 0) {
            push(
              checks,
              'dest-remote-path',
              'Destination path on server',
              'pass',
              `Path exists or parent is writable: ${destPath}`
            );
          } else {
            push(
              checks,
              'dest-remote-path',
              'Destination path on server',
              'warn',
              `Could not verify writability of ${destPath} (may still work if mkdir succeeds at run time)`
            );
          }
        } finally {
          ssh.dispose();
        }
      }
    }
  }

  if (destinationKind === 's3' && config.destinationS3Profile) {
    try {
      await testS3Connection(toS3ProfileConfig(config.destinationS3Profile));
      const prefix = normalizeS3Prefix(config.destinationPath);
      push(
        checks,
        'dest-s3',
        'Destination S3',
        'pass',
        `Connection OK (prefix: ${prefix || '(bucket root)'})`
      );
    } catch (error) {
      push(
        checks,
        'dest-s3',
        'Destination S3',
        'fail',
        error instanceof Error ? error.message : 'S3 destination check failed'
      );
    }
  }

  if (destinationKind === 'peer' && config.destinationPeer) {
    const peer = config.destinationPeer;
    if (peer.status !== 'active') {
      push(checks, 'dest-peer', 'Bro peer', 'fail', `Peer status is ${peer.status}`);
    } else if (!peer.outboundToken) {
      push(checks, 'dest-peer', 'Bro peer', 'fail', 'Peer has no outbound token; re-pair');
    } else {
      push(
        checks,
        'dest-peer',
        'Bro peer',
        'pass',
        `${peer.name} · quota ${peer.quotaBytes} bytes · used ${peer.usedBytes}`
      );
    }
  }

  const ok = checks.every((c) => c.status !== 'fail');
  return { ok, checks };
}
