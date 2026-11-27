import { hashApiToken } from '@/lib/auth/api-tokens';
import {
  buildPreBackupLog,
  combineBackupLog,
  formatPreBackupCommandLog,
  LOG_SECTION,
} from '@/lib/backup/log-format';
import { resolveLocalBackupPath } from '@/lib/backup/destination';
import { generateAgeKeyPair } from '@/lib/crypto/age';
import { db } from '@/lib/db';
import { generateStoredEd25519KeyPair } from '@/lib/ssh/generate-key';
import {
  ageKeys,
  ageRecoveryRecipients,
  apiTokens,
  backupConfigs,
  backupHistory,
  gitRepos,
  peerInvites,
  peers,
  s3Profiles,
  servers,
  settings,
  sshKeys,
} from '@/lib/db/schema';
import { formatBytes } from '@/lib/utils';
import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import fs from 'fs/promises';
import { nanoid } from 'nanoid';
import path from 'path';

const GB = 1024 * 1024 * 1024;
const MB = 1024 * 1024;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const DEMO_SSH_KEY_PLACEHOLDER =
  '-----BEGIN OPENSSH PRIVATE KEY-----\nDEMO_KEY_NOT_REAL_USE_YOUR_OWN\n-----END OPENSSH PRIVATE KEY-----';

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * HOUR);
}

function daysAgo(d: number, hour = 3, minute = 0): Date {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() - d);
  return date;
}

function dateStamp(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}_${hh}-${mm}`;
}

function versionDir(date: Date): string {
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const base = dateStamp(date).replace('_', '_');
  const [dayPart, clockPart] = base.split('_');
  return `${dayPart}_${clockPart}-${seconds}`;
}

function sqlStamp(date: Date): string {
  return `${dateStamp(date)}`.replace('_', '_').slice(0, 10);
}

function rsyncTransferLog(opts: {
  fileCount: number;
  totalSize: number;
  transferred: number;
  speed?: string;
}): string {
  const { fileCount, totalSize, transferred, speed = '12.4MB/s' } = opts;
  return [
    'sending incremental file list',
    './',
    'var/www/html/',
    'var/www/html/index.php',
    'var/www/html/wp-content/uploads/2026/11/hero.webp',
    'var/www/html/wp-content/themes/site/style.css',
    '...',
    '',
    `Number of files: ${fileCount.toLocaleString()}`,
    `Number of files transferred: ${Math.max(1, Math.floor(fileCount * 0.08)).toLocaleString()}`,
    `Total file size: ${totalSize.toLocaleString()} bytes`,
    `Total transferred file size: ${transferred.toLocaleString()} bytes`,
    'Literal data: ' + transferred.toLocaleString() + ' bytes',
    'Matched data: 0 bytes',
    `sent ${transferred.toLocaleString()} bytes  received 2,184 bytes  ${speed}`,
    `total size is ${totalSize.toLocaleString()}  speedup is ${(totalSize / Math.max(transferred, 1)).toFixed(2)}`,
  ].join('\n');
}

function successLog(opts: {
  fileCount: number;
  totalSize: number;
  transferred: number;
  withPreBackup?: boolean;
  withRetention?: boolean;
}): string {
  const pre = opts.withPreBackup
    ? buildPreBackupLog([
        formatPreBackupCommandLog('pg_dump -Fc --no-owner app > /tmp/app.dump', {
          stdout: 'Dump complete (142 MB)',
          stderr: '',
          code: 0,
        }),
        formatPreBackupCommandLog('gzip -f /tmp/app.dump', {
          stdout: '',
          stderr: '',
          code: 0,
        }),
      ])
    : '';

  const retention = opts.withRetention
    ? [
        LOG_SECTION.fileRetention,
        '',
        'Deleted 3 files older than 90 days',
        'Kept 12 files (min keep: 10)',
      ].join('\n')
    : '';

  return combineBackupLog(pre, rsyncTransferLog(opts), 'rsync', retention);
}

function dockerVolumeLog(opts: { volume: string; size: number; archiveName: string }): string {
  return [
    `$ docker run --rm -v ${opts.volume}:/data:ro alpine tar -czf - -C /data`,
    `Archive: ${opts.archiveName}`,
    `Volume: ${opts.volume}`,
    `Compressed size: ${formatBytes(opts.size)}`,
    'Transfer complete',
  ].join('\n');
}

function databaseLog(opts: { database: string; size: number; container: string }): string {
  return [
    `$ docker exec ${opts.container} pg_dump -Fc --no-owner ${opts.database}`,
    `Dump written to /tmp/${opts.database}.dump`,
    '$ gzip -f /tmp/' + opts.database + '.dump',
    `Compressed size: ${formatBytes(opts.size)}`,
    'Transfer complete',
  ].join('\n');
}

function gitLog(opts: { repo: string; size: number; encrypted: boolean }): string {
  return [
    `$ git clone --mirror git@git.example.com:${opts.repo}.git /tmp/mirror.git`,
    'Cloning into bare repository...',
    'Receiving objects: 100% (18422/18422), done.',
    `Packed mirror.git (${formatBytes(opts.size)})`,
    opts.encrypted ? 'Encryption: age (active key + 1 recovery recipient)' : 'Encryption: none',
    'Upload complete',
  ].join('\n');
}

function s3Log(opts: { bucket: string; key: string; size: number }): string {
  return [
    `Uploading to s3://${opts.bucket}/${opts.key}`,
    `Uploaded 1 object (${formatBytes(opts.size)})`,
    'Transfer complete',
  ].join('\n');
}

function broLog(opts: { peerName: string; key: string; size: number; pending?: boolean }): string {
  return [
    `Encrypting with age (forced for Bro Space)`,
    `Staged artifact for ${opts.peerName} mailbox`,
    `Object: ${opts.key}`,
    `Size: ${formatBytes(opts.size)}`,
    opts.pending
      ? 'Waiting for bro to pull and acknowledge'
      : `Acknowledged by ${opts.peerName} (mailbox sync complete)`,
  ].join('\n');
}

function failLog(method: string, message: string, lines: string[]): string {
  return combineBackupLog('', [...lines, '', message].join('\n'), method);
}

export type SeedDemoResult = {
  servers: number;
  backups: number;
  history: number;
  sshKeys: number;
  ids: {
    servers: Record<string, string>;
    backups: Record<string, string>;
    history: Record<string, string>;
    peers: Record<string, string>;
    s3: Record<string, string>;
    git: Record<string, string>;
  };
};

async function upsertSetting(key: string, value: string, now: Date): Promise<void> {
  const existing = await db.query.settings.findFirst({
    where: eq(settings.key, key),
  });
  if (existing) {
    if (existing.value !== value) {
      await db
        .update(settings)
        .set({ value, updatedAt: now })
        .where(eq(settings.key, key));
    }
    return;
  }
  await db.insert(settings).values({
    id: nanoid(),
    key,
    value,
    createdAt: now,
    updatedAt: now,
  });
}

async function writeSparseFile(filePath: string, bytes: number, mtime: Date): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const handle = await fs.open(filePath, 'w');
  try {
    await handle.truncate(Math.trunc(bytes));
  } finally {
    await handle.close();
  }
  await fs.utimes(filePath, mtime, mtime);
}

/**
 * Optional demo files so Storage cards and destination listings have real data
 * to summarize. Only runs when BACKUP_STORAGE_PATH is explicitly configured;
 * the marker file makes repeat seeds safe (we never delete unmarked data).
 */
async function seedLocalStorageFixtures(
  storageRoot: string,
  dests: {
    wordpress: string;
    postgres: string;
    redis: string;
    nginx: string;
    blog: string;
  }
): Promise<void> {
  if (!storageRoot || storageRoot === '/' || storageRoot === '/backups') return;

  const marker = `${storageRoot.replace(/[\\/]+$/, '')}.seed-demo-fixtures`;
  let managed = false;
  try {
    await fs.access(marker);
    managed = true;
  } catch {
    managed = false;
  }

  await fs.mkdir(storageRoot, { recursive: true });
  if (managed) {
    for (const dest of Object.values(dests)) {
      await fs.rm(dest, { recursive: true, force: true });
    }
  } else {
    await fs.mkdir(path.dirname(marker), { recursive: true });
    await fs.writeFile(
      marker,
      'Placeholder files created by LazyBackup seedDemoData(). Safe to delete.\n',
      'utf8'
    );
  }

  const wpVersions = [hoursAgo(22), hoursAgo(46), hoursAgo(70)];
  for (const [index, date] of wpVersions.entries()) {
    const dir = path.join(dests.wordpress, versionDir(date));
    await fs.mkdir(dir, { recursive: true });
    await writeSparseFile(
      path.join(dir, 'wordpress-site.tar.gz.age'),
      (2.1 + index * 0.08) * GB,
      date
    );
    await writeSparseFile(path.join(dir, 'manifest.json'), 9_400, date);
    await fs.utimes(dir, date, date);
  }

  const pgFiles: Array<[string, number, Date]> = [
    [`postgres-app_${sqlStamp(hoursAgo(3))}_0100.sql.gz`, 438 * MB, hoursAgo(3)],
    [`postgres-app_${sqlStamp(hoursAgo(27))}_0100.sql.gz`, 431 * MB, hoursAgo(27)],
    [`postgres-app_${sqlStamp(hoursAgo(51))}_0100.sql.gz`, 426 * MB, hoursAgo(51)],
  ];
  for (const [name, bytes, date] of pgFiles) {
    await writeSparseFile(path.join(dests.postgres, name), bytes, date);
  }

  for (const [index, date] of [hoursAgo(28), hoursAgo(52)].entries()) {
    const dir = path.join(dests.redis, versionDir(date));
    await fs.mkdir(dir, { recursive: true });
    await writeSparseFile(
      path.join(dir, 'redis-data.tar.gz'),
      (612 + index * 9) * MB,
      date
    );
    await fs.utimes(dir, date, date);
  }

  for (const [index, date] of [hoursAgo(19), hoursAgo(187)].entries()) {
    const dir = path.join(dests.nginx, versionDir(date));
    await fs.mkdir(dir, { recursive: true });
    await writeSparseFile(path.join(dir, 'nginx-configs.tar.gz'), 1_240_000 + index * 8_000, date);
    await fs.utimes(dir, date, date);
  }

  for (const [index, date] of [daysAgo(6, 5, 0), daysAgo(14, 5, 0)].entries()) {
    const dir = path.join(dests.blog, versionDir(date));
    await fs.mkdir(dir, { recursive: true });
    await writeSparseFile(
      path.join(dir, 'blog-content.tar.gz'),
      (318 + index * 7) * MB,
      date
    );
    await fs.utimes(dir, date, date);
  }
}

/**
 * Settings → SSH derives the authorized_keys install command from the private
 * key, so the demo row must hold a parseable key. Generate a throwaway ed25519
 * pair when ssh-keygen is available; fall back to the placeholder otherwise.
 */
async function demoPrivateKey(): Promise<string> {
  try {
    const { privateKey } = await generateStoredEd25519KeyPair('lazybackup-demo');
    return privateKey;
  } catch {
    return DEMO_SSH_KEY_PLACEHOLDER;
  }
}

/**
 * Wipe demo resources and insert screenshot-friendly fixtures.
 * Leaves auth tables/settings untouched (app password, passkeys, session secret).
 */
export async function seedDemoData(): Promise<SeedDemoResult> {
  const now = new Date();

  // Cascade deletes configs + history.
  await db.delete(backupConfigs);
  await db.delete(peerInvites);
  await db.delete(peers);
  await db.delete(gitRepos);
  await db.delete(s3Profiles);
  await db.delete(servers);
  await db.delete(sshKeys);
  await db.delete(ageKeys);
  await db.delete(ageRecoveryRecipients);
  await db.delete(apiTokens);

  const storageRoot = process.env.BACKUP_STORAGE_PATH
    ? resolveLocalBackupPath(process.env.BACKUP_STORAGE_PATH)
    : '/backups';

  const keyId = nanoid();
  const keyCreated = daysAgo(180);
  await db.insert(sshKeys).values({
    id: keyId,
    name: 'Bootstrap key (ed25519)',
    privateKeyPath: null,
    publicKeyPath: null,
    privateKeyContent: await demoPrivateKey(),
    createdAt: keyCreated,
    updatedAt: now,
  });

  const serverIds = {
    production: nanoid(),
    staging: nanoid(),
    blog: nanoid(),
    nas: nanoid(),
  };

  await db.insert(servers).values([
    {
      id: serverIds.production,
      name: 'Production · fra1',
      host: 'prod-fra1.example.com',
      port: 22,
      username: 'deploy',
      authType: 'key',
      password: null,
      privateKey: null,
      sshKeyId: keyId,
      systemKeyPath: null,
      createdAt: daysAgo(120),
      updatedAt: now,
    },
    {
      id: serverIds.staging,
      name: 'Staging · nyc1',
      host: 'staging-nyc1.example.com',
      port: 22,
      username: 'deploy',
      authType: 'key',
      password: null,
      privateKey: null,
      sshKeyId: keyId,
      systemKeyPath: null,
      createdAt: daysAgo(95),
      updatedAt: now,
    },
    {
      id: serverIds.blog,
      name: 'Blog VPS · ams3',
      host: 'blog.example.com',
      port: 22,
      username: 'ubuntu',
      authType: 'key',
      password: null,
      privateKey: null,
      sshKeyId: null,
      systemKeyPath: '~/.ssh/id_ed25519',
      createdAt: daysAgo(70),
      updatedAt: now,
    },
    {
      id: serverIds.nas,
      name: 'Legacy NAS · office',
      host: '203.0.113.24',
      port: 2222,
      username: 'backup',
      authType: 'password',
      password: 'demo-password-not-real',
      privateKey: null,
      sshKeyId: null,
      systemKeyPath: null,
      createdAt: daysAgo(45),
      updatedAt: now,
    },
  ]);

  const minioId = nanoid();
  const r2Id = nanoid();
  const minioBucket = 'lazybackup';
  const r2Bucket = 'lazybackup-offsite';
  await db.insert(s3Profiles).values([
    {
      id: minioId,
      name: 'MinIO · homelab',
      endpoint: 'https://minio.example.com',
      region: 'us-east-1',
      bucket: minioBucket,
      accessKeyId: 'lazybackup-demo',
      secretAccessKey: 'minio-demo-secret-not-real',
      forcePathStyle: true,
      createdAt: daysAgo(60),
      updatedAt: now,
    },
    {
      id: r2Id,
      name: 'Cloudflare R2 · offsite',
      endpoint: 'https://a1b2c3d4e5.r2.cloudflarestorage.com',
      region: 'auto',
      bucket: r2Bucket,
      accessKeyId: 'r2-demo-access',
      secretAccessKey: 'r2-demo-secret-not-real',
      forcePathStyle: false,
      createdAt: daysAgo(40),
      updatedAt: now,
    },
  ]);

  const lazybackupRepoId = nanoid();
  const docsRepoId = nanoid();
  await db.insert(gitRepos).values([
    {
      id: lazybackupRepoId,
      name: 'lazybackup (mirror)',
      url: 'git@git.example.com:ops/lazybackup.git',
      sshKeyId: keyId,
      createdAt: daysAgo(30),
      updatedAt: now,
    },
    {
      id: docsRepoId,
      name: 'docs site',
      url: 'https://git.example.com/team/docs.git',
      sshKeyId: null,
      createdAt: daysAgo(25),
      updatedAt: now,
    },
  ]);

  const peerId = nanoid();
  const peerName = 'Basement NAS · bro';
  await db.insert(peers).values({
    id: peerId,
    name: peerName,
    remoteBaseUrl: 'https://bro.example.net',
    remotePeerId: nanoid(),
    outboundToken: 'lbpeer_demo_outbound_token_not_real',
    inboundTokenHash: createHash('sha256')
      .update('lbpeer_demo_inbound_token_not_real')
      .digest('hex'),
    inboundTokenPrefix: 'lbpeer_4f8a…',
    quotaBytes: 50 * GB,
    usedBytes: 14_200_000_000,
    transport: 'mailbox',
    status: 'active',
    lastSeenAt: hoursAgo(0.2),
    lastActivityAt: hoursAgo(2),
    createdAt: daysAgo(21),
    updatedAt: now,
  });

  await db.insert(peerInvites).values({
    id: nanoid(),
    code: 'lb1.demo4f8a2c9e1b7d',
    secretHash: createHash('sha256').update('demo-invite-secret').digest('hex'),
    quotaBytes: 25 * GB,
    localBaseUrl: 'https://lazybackup.example.com',
    label: 'Studio Mac mini',
    status: 'pending',
    expiresAt: new Date(now.getTime() + 2 * DAY),
    createdAt: hoursAgo(5),
  });

  // Real, throwaway age keys so the encryption panel renders and status is honest.
  const activeKeyPair = await generateAgeKeyPair();
  const retiredKeyPair = await generateAgeKeyPair();
  const recoveryPair = await generateAgeKeyPair();
  const activeKeyId = nanoid();
  const retiredKeyId = nanoid();
  await db.insert(ageKeys).values([
    {
      id: activeKeyId,
      label: 'Primary 2026',
      identity: activeKeyPair.identity,
      recipient: activeKeyPair.recipient,
      status: 'active',
      exportAcknowledgedAt: daysAgo(28),
      createdAt: daysAgo(28),
      updatedAt: now,
    },
    {
      id: retiredKeyId,
      label: 'Key 2025 (retired)',
      identity: retiredKeyPair.identity,
      recipient: retiredKeyPair.recipient,
      status: 'retired',
      exportAcknowledgedAt: daysAgo(290),
      createdAt: daysAgo(300),
      updatedAt: daysAgo(28),
    },
  ]);
  await db.insert(ageRecoveryRecipients).values({
    id: nanoid(),
    label: 'Paper copy · safe',
    recipient: recoveryPair.recipient,
    createdAt: daysAgo(27),
  });

  const tokenSpecs = [
    {
      name: 'Claude Desktop',
      permissions: '[]',
      createdAt: daysAgo(24),
      lastUsedAt: hoursAgo(2),
    },
    {
      name: 'Ops dashboard',
      permissions: JSON.stringify(['read_only']),
      createdAt: daysAgo(12),
      lastUsedAt: daysAgo(3),
    },
    {
      name: 'sshya laptop',
      permissions: JSON.stringify(['read_only', 'authorize_keys']),
      createdAt: daysAgo(4),
      lastUsedAt: hoursAgo(1),
    },
  ];
  await db.insert(apiTokens).values(
    tokenSpecs.map((token, index) => {
      const plaintext = `lb_${createHash('sha256')
        .update(`${token.name}-${index}-demo`)
        .digest('hex')}`;
      return {
        id: nanoid(),
        name: token.name,
        tokenHash: hashApiToken(plaintext),
        tokenPrefix: `${plaintext.slice(0, 11)}…`,
        permissions: token.permissions,
        createdAt: token.createdAt,
        lastUsedAt: token.lastUsedAt,
        revokedAt: null,
      };
    })
  );

  const localDest = {
    wordpress: path.join(storageRoot, 'prod', 'wordpress'),
    postgres: path.join(storageRoot, 'db', 'postgres'),
    redis: path.join(storageRoot, 'prod', 'redis'),
    nginx: path.join(storageRoot, 'prod', 'nginx'),
    blog: path.join(storageRoot, 'blog'),
  };

  const backupIds = {
    wordpress: nanoid(),
    uploads: nanoid(),
    postgres: nanoid(),
    redis: nanoid(),
    nginx: nanoid(),
    git: nanoid(),
    offsite: nanoid(),
    blog: nanoid(),
    instance: nanoid(),
  };

  const wpVersion = versionDir(hoursAgo(22));
  const pgFile = `postgres-app_${sqlStamp(hoursAgo(3))}_0100.sql.gz`;
  const redisVersion = versionDir(hoursAgo(28));
  const nginxVersion = versionDir(hoursAgo(19));
  const blogVersion = versionDir(daysAgo(6, 5, 0));

  const validation = {
    wordpress: {
      ok: true,
      at: hoursAgo(2),
      checks: [
        {
          id: 'source-endpoint',
          label: 'Source endpoint',
          status: 'pass',
          message: 'Production · fra1 reachable — rsync 3.2.7 present.',
        },
        {
          id: 'destination',
          label: 'Destination',
          status: 'pass',
          message: 'Local path is writable.',
        },
        {
          id: 'schedule',
          label: 'Schedule',
          status: 'pass',
          message: 'Daily at 02:00 Europe/Madrid — next run in 14 hours.',
        },
        {
          id: 'encryption',
          label: 'Encryption',
          status: 'pass',
          message: 'Active age key plus 1 recovery recipient.',
        },
        {
          id: 'retention',
          label: 'Retention',
          status: 'warn',
          message: 'File retention is off; versions are capped at 7.',
        },
      ],
    },
    postgres: {
      ok: true,
      at: hoursAgo(1),
      checks: [
        {
          id: 'source-endpoint',
          label: 'Source endpoint',
          status: 'pass',
          message: 'Production · fra1 reachable.',
        },
        {
          id: 'docker',
          label: 'Docker client',
          status: 'pass',
          message: 'Container app-postgres is running on the source host.',
        },
        {
          id: 'database',
          label: 'Database login',
          status: 'pass',
          message: 'SELECT 1 succeeded as postgres on app.',
        },
        {
          id: 'destination',
          label: 'Destination',
          status: 'pass',
          message: 'Local path is writable.',
        },
      ],
    },
    redis: {
      ok: false,
      at: hoursAgo(5),
      checks: [
        {
          id: 'source-endpoint',
          label: 'Source endpoint',
          status: 'pass',
          message: 'Docker volume app_redis_data found on Production · fra1.',
        },
        {
          id: 'destination',
          label: 'Destination',
          status: 'pass',
          message: 'Local path is writable.',
        },
        {
          id: 'space',
          label: 'Free space',
          status: 'fail',
          message:
            'Destination has 1.2 GB free; the last archive was 612 MB. Retention runs after the copy, so leave headroom.',
        },
      ],
    },
    nginx: {
      ok: true,
      at: daysAgo(2),
      checks: [
        {
          id: 'source-endpoint',
          label: 'Source endpoint',
          status: 'pass',
          message: 'Production · fra1 reachable — reading /etc/nginx.',
        },
        {
          id: 'destination',
          label: 'Destination',
          status: 'pass',
          message: 'Local path is writable.',
        },
        {
          id: 'schedule',
          label: 'Schedule',
          status: 'pass',
          message: 'Weekly on Sunday at 03:00 Europe/Madrid.',
        },
      ],
    },
  };

  const backupRows: (typeof backupConfigs.$inferInsert)[] = [
    {
      id: backupIds.wordpress,
      sourceKind: 'server',
      serverId: serverIds.production,
      sourceS3ProfileId: null,
      sourceGitRepoId: null,
      destinationKind: 'local',
      destinationServerId: null,
      destinationS3ProfileId: null,
      destinationPeerId: null,
      name: 'WordPress site',
      sourceType: 'path',
      sourcePath: '/var/www/html',
      destinationPath: localDest.wordpress,
      schedule: '0 2 * * *',
      excludePatterns: JSON.stringify(['*.log', 'cache/', 'node_modules/', '.git/']),
      preBackupCommands: null,
      dbEngine: null,
      dbClient: null,
      dbContainer: null,
      dbHost: null,
      dbPort: null,
      dbUser: null,
      dbPassword: null,
      enabled: true,
      enableEncryption: true,
      deleteExtraneous: false,
      enableVersioning: true,
      versionsToKeep: 7,
      enableFileRetention: false,
      retentionMaxAge: 90,
      retentionMaxAgeUnit: 'days',
      retentionMinKeep: 5,
      lastValidatedAt: validation.wordpress.at,
      lastValidationOk: validation.wordpress.ok,
      lastValidationChecks: JSON.stringify(validation.wordpress.checks),
      createdAt: daysAgo(120),
      updatedAt: now,
    },
    {
      id: backupIds.blog,
      sourceKind: 'server',
      serverId: serverIds.blog,
      sourceS3ProfileId: null,
      sourceGitRepoId: null,
      destinationKind: 'local',
      destinationServerId: null,
      destinationS3ProfileId: null,
      destinationPeerId: null,
      name: 'Blog content',
      sourceType: 'path',
      sourcePath: '/home/ubuntu/site',
      destinationPath: localDest.blog,
      schedule: '0 5 * * 1,4',
      excludePatterns: JSON.stringify(['.cache/']),
      preBackupCommands: null,
      dbEngine: null,
      dbClient: null,
      dbContainer: null,
      dbHost: null,
      dbPort: null,
      dbUser: null,
      dbPassword: null,
      enabled: false,
      enableEncryption: false,
      deleteExtraneous: false,
      enableVersioning: true,
      versionsToKeep: 5,
      enableFileRetention: false,
      retentionMaxAge: 30,
      retentionMaxAgeUnit: 'days',
      retentionMinKeep: 5,
      lastValidatedAt: daysAgo(8),
      lastValidationOk: true,
      lastValidationChecks: JSON.stringify([
        {
          id: 'source-endpoint',
          label: 'Source endpoint',
          status: 'pass',
          message: 'Blog VPS · ams3 reachable.',
        },
        {
          id: 'destination',
          label: 'Destination',
          status: 'pass',
          message: 'Local path is writable.',
        },
      ]),
      createdAt: daysAgo(90),
      updatedAt: daysAgo(7),
    },
    {
      id: backupIds.instance,
      sourceKind: 'local',
      serverId: null,
      sourceS3ProfileId: null,
      sourceGitRepoId: null,
      destinationKind: 'server',
      destinationServerId: serverIds.staging,
      destinationS3ProfileId: null,
      destinationPeerId: null,
      name: 'LazyBackup instance',
      sourceType: 'lazybackup_instance',
      sourcePath: 'lazybackup-instance',
      destinationPath: '/srv/backups/lazybackup',
      schedule: '0 4 * * 0',
      excludePatterns: null,
      preBackupCommands: null,
      dbEngine: null,
      dbClient: null,
      dbContainer: null,
      dbHost: null,
      dbPort: null,
      dbUser: null,
      dbPassword: null,
      instanceBackupPassphrase: 'demo-archive-passphrase-not-real',
      enabled: true,
      enableEncryption: false,
      deleteExtraneous: false,
      enableVersioning: true,
      versionsToKeep: 4,
      enableFileRetention: false,
      retentionMaxAge: 30,
      retentionMaxAgeUnit: 'days',
      retentionMinKeep: 2,
      createdAt: daysAgo(2),
      updatedAt: now,
    },
    {
      id: backupIds.nginx,
      sourceKind: 'server',
      serverId: serverIds.production,
      sourceS3ProfileId: null,
      sourceGitRepoId: null,
      destinationKind: 'local',
      destinationServerId: null,
      destinationS3ProfileId: null,
      destinationPeerId: null,
      name: 'Nginx configs',
      sourceType: 'path',
      sourcePath: '/etc/nginx',
      destinationPath: localDest.nginx,
      schedule: '0 3 * * 0',
      excludePatterns: JSON.stringify(['*.pid']),
      preBackupCommands: null,
      dbEngine: null,
      dbClient: null,
      dbContainer: null,
      dbHost: null,
      dbPort: null,
      dbUser: null,
      dbPassword: null,
      enabled: true,
      enableEncryption: false,
      deleteExtraneous: true,
      enableVersioning: true,
      versionsToKeep: 4,
      enableFileRetention: false,
      retentionMaxAge: 30,
      retentionMaxAgeUnit: 'days',
      retentionMinKeep: 3,
      lastValidatedAt: daysAgo(2),
      lastValidationOk: true,
      lastValidationChecks: JSON.stringify(validation.nginx.checks),
      createdAt: daysAgo(100),
      updatedAt: now,
    },
    {
      id: backupIds.redis,
      sourceKind: 'server',
      serverId: serverIds.production,
      sourceS3ProfileId: null,
      sourceGitRepoId: null,
      destinationKind: 'local',
      destinationServerId: null,
      destinationS3ProfileId: null,
      destinationPeerId: null,
      name: 'Redis data volume',
      sourceType: 'docker_volume',
      sourcePath: 'app_redis_data',
      destinationPath: localDest.redis,
      schedule: '15 3 * * *',
      excludePatterns: null,
      preBackupCommands: null,
      dbEngine: null,
      dbClient: null,
      dbContainer: null,
      dbHost: null,
      dbPort: null,
      dbUser: null,
      dbPassword: null,
      enabled: true,
      enableEncryption: false,
      deleteExtraneous: false,
      enableVersioning: true,
      versionsToKeep: 5,
      enableFileRetention: false,
      retentionMaxAge: 30,
      retentionMaxAgeUnit: 'days',
      retentionMinKeep: 2,
      lastValidatedAt: validation.redis.at,
      lastValidationOk: validation.redis.ok,
      lastValidationChecks: JSON.stringify(validation.redis.checks),
      createdAt: daysAgo(75),
      updatedAt: now,
    },
    {
      id: backupIds.postgres,
      sourceKind: 'server',
      serverId: serverIds.production,
      sourceS3ProfileId: null,
      sourceGitRepoId: null,
      destinationKind: 'local',
      destinationServerId: null,
      destinationS3ProfileId: null,
      destinationPeerId: null,
      name: 'PostgreSQL · app DB',
      sourceType: 'database',
      sourcePath: 'app',
      destinationPath: localDest.postgres,
      schedule: '0 1 * * *',
      excludePatterns: null,
      preBackupCommands: null,
      dbEngine: 'postgres',
      dbClient: 'docker',
      dbContainer: 'app-postgres',
      dbHost: '127.0.0.1',
      dbPort: 5432,
      dbUser: 'postgres',
      dbPassword: 'demo-db-password-not-real',
      enabled: true,
      enableEncryption: false,
      deleteExtraneous: false,
      enableVersioning: false,
      versionsToKeep: 5,
      enableFileRetention: true,
      retentionMaxAge: 30,
      retentionMaxAgeUnit: 'days',
      retentionMinKeep: 7,
      lastValidatedAt: validation.postgres.at,
      lastValidationOk: validation.postgres.ok,
      lastValidationChecks: JSON.stringify(validation.postgres.checks),
      createdAt: daysAgo(65),
      updatedAt: now,
    },
    {
      id: backupIds.uploads,
      sourceKind: 'server',
      serverId: serverIds.production,
      sourceS3ProfileId: null,
      sourceGitRepoId: null,
      destinationKind: 'peer',
      destinationServerId: null,
      destinationS3ProfileId: null,
      destinationPeerId: peerId,
      name: 'Media uploads',
      sourceType: 'path',
      sourcePath: '/var/www/html/wp-content/uploads',
      destinationPath: 'media/uploads',
      schedule: '30 1 * * *',
      excludePatterns: JSON.stringify(['*.tmp']),
      preBackupCommands: null,
      dbEngine: null,
      dbClient: null,
      dbContainer: null,
      dbHost: null,
      dbPort: null,
      dbUser: null,
      dbPassword: null,
      enabled: true,
      enableEncryption: false,
      deleteExtraneous: false,
      enableVersioning: false,
      versionsToKeep: 5,
      enableFileRetention: true,
      retentionMaxAge: 90,
      retentionMaxAgeUnit: 'days',
      retentionMinKeep: 10,
      createdAt: daysAgo(60),
      updatedAt: now,
    },
    {
      id: backupIds.git,
      sourceKind: 'git',
      serverId: null,
      sourceS3ProfileId: null,
      sourceGitRepoId: lazybackupRepoId,
      destinationKind: 's3',
      destinationServerId: null,
      destinationS3ProfileId: minioId,
      destinationPeerId: null,
      name: 'Static site (Git mirror)',
      sourceType: 'git_repo',
      sourcePath: 'git-mirror',
      destinationPath: 'git/lazybackup/',
      schedule: '30 4 * * *',
      excludePatterns: null,
      preBackupCommands: null,
      dbEngine: null,
      dbClient: null,
      dbContainer: null,
      dbHost: null,
      dbPort: null,
      dbUser: null,
      dbPassword: null,
      enabled: true,
      enableEncryption: true,
      deleteExtraneous: false,
      enableVersioning: false,
      versionsToKeep: 5,
      enableFileRetention: true,
      retentionMaxAge: 30,
      retentionMaxAgeUnit: 'days',
      retentionMinKeep: 5,
      createdAt: daysAgo(30),
      updatedAt: now,
    },
    {
      id: backupIds.offsite,
      sourceKind: 'server',
      serverId: serverIds.production,
      sourceS3ProfileId: null,
      sourceGitRepoId: null,
      destinationKind: 's3',
      destinationServerId: null,
      destinationS3ProfileId: r2Id,
      destinationPeerId: null,
      name: 'WordPress offsite',
      sourceType: 'path',
      sourcePath: '/var/www/html',
      destinationPath: 'prod/wordpress/',
      schedule: '0 6 * * 0',
      excludePatterns: JSON.stringify(['*.log', 'cache/']),
      preBackupCommands: null,
      dbEngine: null,
      dbClient: null,
      dbContainer: null,
      dbHost: null,
      dbPort: null,
      dbUser: null,
      dbPassword: null,
      enabled: true,
      enableEncryption: true,
      deleteExtraneous: false,
      enableVersioning: false,
      versionsToKeep: 5,
      enableFileRetention: true,
      retentionMaxAge: 60,
      retentionMaxAgeUnit: 'days',
      retentionMinKeep: 4,
      createdAt: daysAgo(50),
      updatedAt: now,
    },
  ];

  await db.insert(backupConfigs).values(backupRows);

  type HistSpec = {
    key?: string;
    configId: string;
    start: Date;
    durationMin: number;
    status: 'success' | 'failed' | 'running';
    fileCount?: number;
    totalSize?: number;
    transferredSize?: number;
    errorMessage?: string;
    withPreBackup?: boolean;
    withRetention?: boolean;
    artifactPath?: string | null;
    mailboxPending?: boolean;
    logOutput?: string;
    kind?: 'path' | 'database' | 'volume' | 'git' | 's3' | 'bro';
  };

  const historyRows: HistSpec[] = [];

  const failMessages = {
    wordpress:
      'rsync exited with code 23: some files were not transferred (permission denied on /var/www/html/wp-content/cache)',
    postgres:
      'pg_dump: error: connection to server at "127.0.0.1", port 5432 failed: FATAL: remaining connection slots are reserved for non-replication superuser connections',
    nginx:
      'SSH connection to prod-fra1.example.com:22 timed out after 30s (ETIMEDOUT) — host unreachable while reading /etc/nginx.',
    git:
      'git clone --mirror failed: fatal: could not read from remote repository (git@git.example.com:ops/lazybackup.git)',
  };

  const failLines = {
    wordpress: [
      'sending incremental file list',
      'rsync: opendir "/var/www/html/wp-content/cache" failed: Permission denied (13)',
      'rsync error: some files/attrs were not transferred (see previous errors) (code 23)',
    ],
    postgres: [
      '$ docker exec app-postgres pg_dump -Fc --no-owner app',
      'pg_dump: error: could not connect to database "app"',
    ],
    nginx: [
      'ssh: connect to host prod-fra1.example.com port 22: Connection timed out',
      'rsync: connection unexpectedly closed (0 bytes received so far) [sender]',
      'rsync error: unexplained error (code 255) at io.c(226) [sender=3.2.7]',
    ],
    git: [
      '$ git clone --mirror git@git.example.com:ops/lazybackup.git /tmp/mirror.git',
      'Cloning into bare repository...',
      'fatal: Could not read from remote repository.',
    ],
  };

  const artifactFor = (kind: HistSpec['kind'], start: Date) => {
    switch (kind) {
      case 'path':
        return `${localDest.wordpress}/${versionDir(start)}/wordpress-site.tar.gz.age`;
      case 'database':
        return `${localDest.postgres}/postgres-app_${sqlStamp(start)}_0100.sql.gz`;
      case 'volume':
        return `${localDest.redis}/${versionDir(start)}/redis-data.tar.gz`;
      case 'git':
        return `s3://${minioBucket}/git/lazybackup/lazybackup-mirror-${dateStamp(start)}.tar.gz.age`;
      case 's3':
        return `s3://${r2Bucket}/prod/wordpress/wordpress-site-${dateStamp(start)}.tar.gz.age`;
      case 'bro':
        return `peer://${peerId}/media/uploads/media-uploads-${dateStamp(start)}.tar.gz.age`;
      default:
        return null;
    }
  };

  // 30 days of mostly successful runs for the daily jobs.
  const dailyJobs: Array<{
    configId: string;
    kind: HistSpec['kind'];
    hour: number;
    baseFiles: number;
    baseSize: number;
    withPreBackup?: boolean;
    withRetention?: boolean;
  }> = [
    {
      configId: backupIds.wordpress,
      kind: 'path',
      hour: 2,
      baseFiles: 18420,
      baseSize: 2_450_000_000,
    },
    {
      configId: backupIds.postgres,
      kind: 'database',
      hour: 1,
      baseFiles: 1,
      baseSize: 438_000_000,
      withPreBackup: true,
      withRetention: true,
    },
    {
      configId: backupIds.redis,
      kind: 'volume',
      hour: 3,
      baseFiles: 1,
      baseSize: 618_000_000,
    },
    {
      configId: backupIds.uploads,
      kind: 'bro',
      hour: 1,
      baseFiles: 9580,
      baseSize: 8_340_000_000,
      withRetention: true,
    },
    {
      configId: backupIds.git,
      kind: 'git',
      hour: 4,
      baseFiles: 1,
      baseSize: 126_000_000,
    },
  ];

  for (let day = 29; day >= 2; day--) {
    for (const job of dailyJobs) {
      if (job.configId === backupIds.redis && day % 3 === 0) continue;
      if (job.configId === backupIds.git && day % 2 === 0) continue;

      const jitter = ((day * 17 + job.baseFiles) % 97) / 100;
      const totalSize = Math.round(job.baseSize * (0.92 + jitter * 0.12));
      const transferred = Math.round(totalSize * (0.04 + (day % 9) * 0.01));
      const fileCount = Math.round(job.baseFiles * (0.95 + jitter * 0.08));
      const start = daysAgo(day, job.hour, (day * 3) % 50);
      const durationMin = 4 + (day % 12);

      let status: HistSpec['status'] = 'success';
      let errorMessage: string | undefined;
      if (day === 6 && job.configId === backupIds.wordpress) {
        status = 'failed';
        errorMessage = failMessages.wordpress;
      } else if (day === 12 && job.configId === backupIds.postgres) {
        status = 'failed';
        errorMessage = failMessages.postgres;
      } else if (day === 3 && job.configId === backupIds.git) {
        status = 'failed';
        errorMessage = failMessages.git;
      }

      historyRows.push({
        configId: job.configId,
        kind: job.kind,
        start,
        durationMin: status === 'failed' ? 1 : durationMin,
        status,
        fileCount: status === 'failed' ? 0 : fileCount,
        totalSize: status === 'failed' ? 0 : totalSize,
        transferredSize: status === 'failed' ? 0 : transferred,
        errorMessage,
        withPreBackup: job.withPreBackup,
        withRetention: job.withRetention,
        artifactPath: status === 'success' ? artifactFor(job.kind, start) : null,
        mailboxPending: false,
      });
    }
  }

  // Weekly runs while the blog was enabled.
  for (const day of [24, 17, 10, 6]) {
    const start = daysAgo(day, 5, 0);
    historyRows.push({
      configId: backupIds.blog,
      kind: 'path',
      start,
      durationMin: 6,
      status: 'success',
      fileCount: 2100 + day,
      totalSize: 310_000_000,
      transferredSize: 12_000_000,
      artifactPath: `${localDest.blog}/${versionDir(start)}/blog-content.tar.gz`,
    });
  }

  // Weekly nginx history; the newest run is the unresolved failure.
  for (const day of [22, 15, 8]) {
    const start = daysAgo(day, 3, 5);
    historyRows.push({
      configId: backupIds.nginx,
      kind: 'path',
      start,
      durationMin: 2,
      status: 'success',
      fileCount: 86,
      totalSize: 1_240_000,
      transferredSize: 48_000,
      artifactPath: `${localDest.nginx}/${versionDir(start)}/nginx-configs.tar.gz`,
    });
  }

  // Weekly offsite copy.
  for (const day of [16, 9, 2]) {
    const start = daysAgo(day, 6, 0);
    historyRows.push({
      configId: backupIds.offsite,
      kind: 's3',
      start,
      durationMin: 12,
      status: 'success',
      fileCount: 19104,
      totalSize: 2_512_000_000,
      transferredSize: 186_000_000,
      artifactPath: artifactFor('s3', start) ?? null,
    });
  }

  // Recent, hand-placed runs: dashboard health, list badges, Bro mailbox, restore.
  historyRows.push(
    {
      key: 'wp-running',
      configId: backupIds.wordpress,
      kind: 'path',
      start: hoursAgo(0.2),
      durationMin: 0,
      status: 'running',
    },
    {
      key: 'postgres-success',
      configId: backupIds.postgres,
      kind: 'database',
      start: hoursAgo(3),
      durationMin: 7,
      status: 'success',
      fileCount: 1,
      totalSize: 438_000_000,
      transferredSize: 438_000_000,
      withPreBackup: true,
      withRetention: true,
      artifactPath: `${localDest.postgres}/${pgFile}`,
    },
    {
      key: 'uploads-bro',
      configId: backupIds.uploads,
      kind: 'bro',
      start: hoursAgo(9),
      durationMin: 18,
      status: 'success',
      fileCount: 9680,
      totalSize: 8_390_000_000,
      transferredSize: 420_000_000,
      withRetention: true,
      mailboxPending: true,
      artifactPath: `peer://${peerId}/media/uploads/media-uploads-latest.tar.gz.age`,
    },
    {
      key: 'git-success',
      configId: backupIds.git,
      kind: 'git',
      start: hoursAgo(12),
      durationMin: 4,
      status: 'success',
      fileCount: 1,
      totalSize: 126_000_000,
      transferredSize: 126_000_000,
      artifactPath: `s3://${minioBucket}/git/lazybackup/lazybackup-mirror-latest.tar.gz.age`,
    },
    {
      key: 'nginx-failed',
      configId: backupIds.nginx,
      kind: 'path',
      start: hoursAgo(19),
      durationMin: 1,
      status: 'failed',
      errorMessage: failMessages.nginx,
    },
    {
      configId: backupIds.git,
      kind: 'git',
      start: hoursAgo(23),
      durationMin: 1,
      status: 'failed',
      errorMessage: failMessages.git,
    },
    {
      key: 'wordpress-success',
      configId: backupIds.wordpress,
      kind: 'path',
      start: hoursAgo(22),
      durationMin: 11,
      status: 'success',
      fileCount: 19102,
      totalSize: 2_512_000_000,
      transferredSize: 186_000_000,
      artifactPath: `${localDest.wordpress}/${wpVersion}/wordpress-site.tar.gz.age`,
    },
    {
      key: 'redis-success',
      configId: backupIds.redis,
      kind: 'volume',
      start: hoursAgo(28),
      durationMin: 5,
      status: 'success',
      fileCount: 1,
      totalSize: 612_000_000,
      transferredSize: 612_000_000,
      artifactPath: `${localDest.redis}/${redisVersion}/redis-data.tar.gz`,
    },
    {
      key: 'blog-success',
      configId: backupIds.blog,
      kind: 'path',
      start: daysAgo(6, 5, 0),
      durationMin: 6,
      status: 'success',
      fileCount: 2106,
      totalSize: 318_000_000,
      transferredSize: 9_400_000,
      artifactPath: `${localDest.blog}/${blogVersion}/blog-content.tar.gz`,
    }
  );

  const historyIds: Record<string, string> = {};
  const historyValues = historyRows.map((row) => {
    const id = nanoid();
    if (row.key) historyIds[row.key] = id;
    const end =
      row.status === 'running'
        ? null
        : new Date(row.start.getTime() + row.durationMin * 60 * 1000);

    let logOutput = row.logOutput ?? null;
    if (!logOutput && row.status === 'success') {
      if (row.kind === 'bro') {
        logOutput = combineBackupLog(
          '',
          broLog({
            peerName,
            key: `media/uploads/media-uploads-${dateStamp(row.start)}.tar.gz.age`,
            size: row.transferredSize ?? 0,
            pending: Boolean(row.mailboxPending),
          }),
          'rsync'
        );
      } else if (row.kind === 'database') {
        logOutput = combineBackupLog(
          row.withPreBackup
            ? buildPreBackupLog([
                formatPreBackupCommandLog('pg_dump -Fc --no-owner app > /tmp/app.dump', {
                  stdout: 'Dump complete (438 MB)',
                  stderr: '',
                  code: 0,
                }),
              ])
            : '',
          databaseLog({
            database: 'app',
            size: row.transferredSize ?? 0,
            container: 'app-postgres',
          }),
          'database',
          row.withRetention
            ? [
                LOG_SECTION.fileRetention,
                '',
                'Deleted 1 dump older than 30 days',
                'Kept 7 dumps (min keep: 7)',
              ].join('\n')
            : ''
        );
      } else if (row.kind === 'volume') {
        logOutput = combineBackupLog(
          '',
          dockerVolumeLog({
            volume: 'app_redis_data',
            size: row.totalSize ?? 0,
            archiveName: `redis-data-${dateStamp(row.start)}.tar.gz`,
          }),
          'docker'
        );
      } else if (row.kind === 'git') {
        logOutput = combineBackupLog(
          '',
          gitLog({ repo: 'ops/lazybackup', size: row.totalSize ?? 0, encrypted: true }),
          'git'
        );
      } else if (row.kind === 's3') {
        logOutput = combineBackupLog(
          '',
          s3Log({
            bucket: r2Bucket,
            key: `prod/wordpress/wordpress-site-${dateStamp(row.start)}.tar.gz.age`,
            size: row.totalSize ?? 0,
          }),
          'rsync'
        );
      } else {
        logOutput = successLog({
          fileCount: row.fileCount ?? 0,
          totalSize: row.totalSize ?? 0,
          transferred: row.transferredSize ?? 0,
          withPreBackup: row.withPreBackup,
          withRetention: row.withRetention,
        });
      }
    } else if (!logOutput && row.status === 'failed') {
      const key =
        row.configId === backupIds.nginx
          ? 'nginx'
          : row.configId === backupIds.postgres
            ? 'postgres'
            : row.configId === backupIds.git
              ? 'git'
              : 'wordpress';
      const method =
        key === 'postgres' ? 'database' : key === 'git' ? 'git' : 'rsync';
      logOutput = failLog(
        method,
        row.errorMessage || 'Backup failed',
        failLines[key as keyof typeof failLines]
      );
    } else if (!logOutput && row.status === 'running') {
      logOutput = combineBackupLog(
        '',
        [
          'sending incremental file list',
          'var/www/html/',
          'var/www/html/index.php',
          'var/www/html/wp-content/uploads/2026/11/hero.webp',
          '...',
          'Transferred 186 MB so far',
        ].join('\n'),
        'rsync'
      );
    }

    return {
      id,
      configId: row.configId,
      startTime: row.start,
      endTime: end,
      status: row.status,
      fileCount: row.fileCount ?? null,
      totalSize: row.totalSize ?? null,
      transferredSize: row.transferredSize ?? null,
      errorMessage: row.errorMessage ?? null,
      logOutput,
      artifactPath: row.artifactPath ?? null,
      mailboxPending: Boolean(row.mailboxPending),
    };
  });

  // Insert in chunks to stay friendly to SQLite.
  const chunk = 40;
  for (let i = 0; i < historyValues.length; i += chunk) {
    await db.insert(backupHistory).values(historyValues.slice(i, i + chunk));
  }

  await seedLocalStorageFixtures(storageRoot, localDest);

  // Settings: timezone + notifications + Bro address. Auth keys are untouched.
  await upsertSetting('timezone', 'Europe/Madrid', now);
  await upsertSetting('failureWebhookUrl', 'https://ntfy.example.com/lazybackup-alerts', now);
  await upsertSetting('failureWebhookMethod', 'POST', now);
  await upsertSetting(
    'failureWebhookHeaders',
    'Title: LazyBackup failure\nPriority: high\nTags: warning,backup',
    now
  );
  await upsertSetting('failureWebhookBody', '{{backupName}}: {{errorMessage}}', now);
  await upsertSetting(
    'successPingUrl',
    'https://hc.example.com/ping/8f3a2c1d-lazybackup',
    now
  );
  await upsertSetting('successPingMethod', 'GET', now);
  await upsertSetting('successPingHeaders', '', now);
  await upsertSetting('successPingBody', '', now);
  await upsertSetting('instanceBaseUrl', 'https://lazybackup.example.com', now);
  await upsertSetting('defaultSshKeyPath', '~/.ssh/id_ed25519', now);
  await upsertSetting('sshKeepAliveInterval', '60', now);

  return {
    servers: 4,
    backups: backupRows.length,
    history: historyValues.length,
    sshKeys: 1,
    ids: {
      servers: serverIds,
      backups: backupIds,
      history: historyIds,
      peers: { active: peerId },
      s3: { minio: minioId, r2: r2Id },
      git: { lazybackup: lazybackupRepoId, docs: docsRepoId },
    },
  };
}
