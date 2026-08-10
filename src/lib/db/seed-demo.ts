import {
  buildPreBackupLog,
  combineBackupLog,
  formatPreBackupCommandLog,
  LOG_SECTION,
} from '@/lib/backup/log-format';
import { db } from '@/lib/db';
import { backupConfigs, backupHistory, servers, settings, sshKeys } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

function daysAgo(d: number, hour = 3, minute = 0): Date {
  const date = new Date();
  date.setHours(hour, minute, 0, 0);
  date.setDate(date.getDate() - d);
  return date;
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
    'var/www/html/wp-content/uploads/2026/07/hero.jpg',
    'var/lib/mysql/dumps/daily.sql.gz',
    '...',
    '',
    `Number of files: ${fileCount.toLocaleString()}`,
    `Number of files transferred: ${Math.max(1, Math.floor(fileCount * 0.08)).toLocaleString()}`,
    `Total file size: ${totalSize.toLocaleString()} bytes`,
    `Total transferred file size: ${transferred.toLocaleString()} bytes`,
    `Literal data: ${transferred.toLocaleString()} bytes`,
    'Matched data: 0 bytes',
    `sent ${transferred.toLocaleString()} bytes  received 2,184 bytes  ${speed}`,
    'total size is ' + totalSize.toLocaleString() + '  speedup is ' + (totalSize / Math.max(transferred, 1)).toFixed(2),
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
        formatPreBackupCommandLog('pg_dump -Fc app > /tmp/app.dump', {
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
    ? [LOG_SECTION.fileRetention, '', 'Deleted 3 files older than 30 days', 'Kept 12 files (min keep: 5)'].join(
        '\n'
      )
    : '';

  return combineBackupLog(pre, rsyncTransferLog(opts), 'rsync', retention);
}

function failLog(message: string): string {
  return combineBackupLog(
    '',
    [
      'sending incremental file list',
      `rsync: [sender] change_dir "/var/www/missing" failed: No such file or directory (2)`,
      `rsync error: some files/attrs were not transferred (see previous errors) (code 23)`,
      '',
      message,
    ].join('\n'),
    'rsync'
  );
}

export type SeedDemoResult = {
  servers: number;
  backups: number;
  history: number;
  sshKeys: number;
};

/**
 * Wipe servers (cascade → configs → history) and insert screenshot-friendly demo data.
 * Leaves auth settings untouched.
 */
export async function seedDemoData(): Promise<SeedDemoResult> {
  // Cascade deletes configs + history
  await db.delete(servers);
  await db.delete(sshKeys);

  const now = new Date();
  const keyId = nanoid();
  await db.insert(sshKeys).values({
    id: keyId,
    name: 'Deploy key (ed25519)',
    privateKeyPath: null,
    publicKeyPath: null,
    privateKeyContent:
      '-----BEGIN OPENSSH PRIVATE KEY-----\nDEMO_KEY_NOT_REAL\n-----END OPENSSH PRIVATE KEY-----',
    createdAt: now,
    updatedAt: now,
  });

  const prodId = nanoid();
  const stagingId = nanoid();
  const blogId = nanoid();
  const dbHostId = nanoid();

  await db.insert(servers).values([
    {
      id: prodId,
      name: 'Production · fra1',
      host: 'prod.lazy.example',
      port: 22,
      username: 'deploy',
      authType: 'key',
      password: null,
      privateKey: null,
      sshKeyId: keyId,
      systemKeyPath: null,
      createdAt: daysAgo(60),
      updatedAt: now,
    },
    {
      id: stagingId,
      name: 'Staging · nyc1',
      host: 'staging.lazy.example',
      port: 22,
      username: 'deploy',
      authType: 'key',
      password: null,
      privateKey: null,
      sshKeyId: keyId,
      systemKeyPath: null,
      createdAt: daysAgo(45),
      updatedAt: now,
    },
    {
      id: blogId,
      name: 'Blog VPS',
      host: 'blog.zic.ar',
      port: 22,
      username: 'ubuntu',
      authType: 'key',
      password: null,
      privateKey: null,
      sshKeyId: keyId,
      systemKeyPath: '~/.ssh/id_ed25519',
      createdAt: daysAgo(30),
      updatedAt: now,
    },
    {
      id: dbHostId,
      name: 'DB dumps host',
      host: 'db.internal.example',
      port: 2222,
      username: 'backup',
      authType: 'key',
      password: null,
      privateKey: null,
      sshKeyId: keyId,
      systemKeyPath: null,
      createdAt: daysAgo(20),
      updatedAt: now,
    },
  ]);

  const wpId = nanoid();
  const nginxId = nanoid();
  const uploadsId = nanoid();
  const pgDumpId = nanoid();
  const stagingAppId = nanoid();
  const blogContentId = nanoid();

  await db.insert(backupConfigs).values([
    {
      id: wpId,
      sourceKind: 'server',
      serverId: prodId,
      destinationKind: 'local',
      destinationServerId: null,
      name: 'WordPress site',
      sourcePath: '/var/www/html',
      destinationPath: '/backups/prod/wordpress',
      schedule: '0 2 * * *',
      excludePatterns: JSON.stringify(['*.log', 'cache/', 'node_modules/', '.git/']),
      preBackupCommands: null,
      enabled: true,
      enableVersioning: true,
      versionsToKeep: 7,
      enableFileRetention: false,
      retentionMaxAge: 30,
      retentionMaxAgeUnit: 'days',
      retentionMinKeep: 5,
      createdAt: daysAgo(55),
      updatedAt: now,
    },
    {
      id: nginxId,
      sourceKind: 'server',
      serverId: prodId,
      destinationKind: 'local',
      destinationServerId: null,
      name: 'Nginx configs',
      sourcePath: '/etc/nginx',
      destinationPath: '/backups/prod/nginx',
      schedule: '0 3 * * 0',
      excludePatterns: JSON.stringify(['*.pid']),
      preBackupCommands: null,
      enabled: true,
      enableVersioning: true,
      versionsToKeep: 4,
      enableFileRetention: false,
      createdAt: daysAgo(50),
      updatedAt: now,
    },
    {
      id: uploadsId,
      sourceKind: 'server',
      serverId: prodId,
      destinationKind: 'local',
      destinationServerId: null,
      name: 'Media uploads',
      sourcePath: '/var/www/html/wp-content/uploads',
      destinationPath: '/backups/prod/uploads',
      schedule: '30 1 * * *',
      excludePatterns: JSON.stringify(['*.tmp']),
      preBackupCommands: null,
      enabled: true,
      enableVersioning: false,
      versionsToKeep: 5,
      enableFileRetention: true,
      retentionMaxAge: 90,
      retentionMaxAgeUnit: 'days',
      retentionMinKeep: 10,
      createdAt: daysAgo(40),
      updatedAt: now,
    },
    {
      id: pgDumpId,
      sourceKind: 'server',
      serverId: dbHostId,
      destinationKind: 'local',
      destinationServerId: null,
      name: 'PostgreSQL nightly dump',
      sourcePath: '/var/backups/postgres',
      destinationPath: '/backups/db/postgres',
      schedule: '0 1 * * *',
      excludePatterns: null,
      preBackupCommands: 'pg_dump -Fc app > /tmp/app.dump\ngzip -f /tmp/app.dump\nmv /tmp/app.dump.gz /var/backups/postgres/',
      enabled: true,
      enableVersioning: false,
      versionsToKeep: 5,
      enableFileRetention: true,
      retentionMaxAge: 30,
      retentionMaxAgeUnit: 'days',
      retentionMinKeep: 7,
      createdAt: daysAgo(18),
      updatedAt: now,
    },
    {
      id: stagingAppId,
      sourceKind: 'server',
      serverId: stagingId,
      destinationKind: 'local',
      destinationServerId: null,
      name: 'Staging app root',
      sourcePath: '/opt/app',
      destinationPath: '/backups/staging/app',
      schedule: '0 4 * * *',
      excludePatterns: JSON.stringify(['node_modules/', '.next/', 'tmp/']),
      preBackupCommands: null,
      enabled: true,
      enableVersioning: true,
      versionsToKeep: 3,
      enableFileRetention: false,
      createdAt: daysAgo(35),
      updatedAt: now,
    },
    {
      id: blogContentId,
      sourceKind: 'server',
      serverId: blogId,
      destinationKind: 'local',
      destinationServerId: null,
      name: 'Blog content',
      sourcePath: '/home/ubuntu/site',
      destinationPath: '/backups/blog',
      schedule: '0 5 * * 1,4',
      excludePatterns: JSON.stringify(['.cache/']),
      preBackupCommands: null,
      enabled: false,
      enableVersioning: true,
      versionsToKeep: 5,
      enableFileRetention: false,
      createdAt: daysAgo(25),
      updatedAt: now,
    },
  ]);

  type HistSpec = {
    configId: string;
    start: Date;
    durationMin: number;
    status: 'success' | 'failed' | 'running';
    fileCount?: number;
    totalSize?: number;
    transferredSize?: number;
    errorMessage?: string | null;
    withPreBackup?: boolean;
    withRetention?: boolean;
  };

  const historyRows: HistSpec[] = [];

  // Dense recent history for dashboard chart (last ~28 days)
  const dailyJobs: Array<{
    configId: string;
    hour: number;
    baseFiles: number;
    baseSize: number;
    withPreBackup?: boolean;
    withRetention?: boolean;
  }> = [
    { configId: wpId, hour: 2, baseFiles: 18420, baseSize: 2_450_000_000 },
    { configId: uploadsId, hour: 1, baseFiles: 9200, baseSize: 8_100_000_000, withRetention: true },
    { configId: pgDumpId, hour: 1, baseFiles: 14, baseSize: 420_000_000, withPreBackup: true, withRetention: true },
    { configId: stagingAppId, hour: 4, baseFiles: 6400, baseSize: 890_000_000 },
  ];

  for (let day = 27; day >= 1; day--) {
    for (const job of dailyJobs) {
      // Skip some days for variety (staging weekends lighter)
      if (job.configId === stagingAppId && day % 7 === 0) continue;
      if (job.configId === uploadsId && day % 5 === 0) continue;

      const fail = day === 11 && job.configId === wpId;
      const fail2 = day === 4 && job.configId === pgDumpId;
      const jitter = ((day * 17 + job.baseFiles) % 97) / 100;
      const totalSize = Math.round(job.baseSize * (0.92 + jitter * 0.12));
      const transferred = Math.round(totalSize * (0.04 + (day % 9) * 0.01));
      const fileCount = Math.round(job.baseFiles * (0.95 + jitter * 0.08));
      const start = daysAgo(day, job.hour, (day * 3) % 50);
      const durationMin = 4 + (day % 12);

      if (fail || fail2) {
        historyRows.push({
          configId: job.configId,
          start,
          durationMin: 1,
          status: 'failed',
          fileCount: 0,
          totalSize: 0,
          transferredSize: 0,
          errorMessage: fail
            ? 'rsync exited with code 23: some files were not transferred'
            : 'SSH connection timed out after 30s',
        });
      } else {
        historyRows.push({
          configId: job.configId,
          start,
          durationMin,
          status: 'success',
          fileCount,
          totalSize,
          transferredSize: transferred,
          withPreBackup: job.withPreBackup,
          withRetention: job.withRetention,
        });
      }
    }
  }

  // Weekly nginx successes
  for (const day of [21, 14, 7, 0]) {
    if (day === 0) continue;
    historyRows.push({
      configId: nginxId,
      start: daysAgo(day, 3, 5),
      durationMin: 2,
      status: 'success',
      fileCount: 86,
      totalSize: 1_240_000,
      transferredSize: 48_000,
    });
  }

  // A couple blog runs while it was enabled
  historyRows.push(
    {
      configId: blogContentId,
      start: daysAgo(20, 5, 0),
      durationMin: 6,
      status: 'success',
      fileCount: 2100,
      totalSize: 310_000_000,
      transferredSize: 12_000_000,
    },
    {
      configId: blogContentId,
      start: daysAgo(16, 5, 0),
      durationMin: 5,
      status: 'success',
      fileCount: 2144,
      totalSize: 318_000_000,
      transferredSize: 9_400_000,
    }
  );

  // Very recent successes for "recent history" list
  historyRows.push(
    {
      configId: pgDumpId,
      start: hoursAgo(3),
      durationMin: 7,
      status: 'success',
      fileCount: 16,
      totalSize: 438_000_000,
      transferredSize: 438_000_000,
      withPreBackup: true,
      withRetention: true,
    },
    {
      configId: wpId,
      start: hoursAgo(5),
      durationMin: 11,
      status: 'success',
      fileCount: 19102,
      totalSize: 2_512_000_000,
      transferredSize: 186_000_000,
    },
    {
      configId: uploadsId,
      start: hoursAgo(8),
      durationMin: 22,
      status: 'success',
      fileCount: 9580,
      totalSize: 8_340_000_000,
      transferredSize: 420_000_000,
      withRetention: true,
    }
  );

  // One currently running for dashboard color
  historyRows.push({
    configId: stagingAppId,
    start: hoursAgo(0.15),
    durationMin: 0,
    status: 'running',
  });

  const historyValues = historyRows.map((row) => {
    const end =
      row.status === 'running'
        ? null
        : new Date(row.start.getTime() + row.durationMin * 60 * 1000);

    let logOutput: string | null = null;
    if (row.status === 'success') {
      logOutput = successLog({
        fileCount: row.fileCount ?? 0,
        totalSize: row.totalSize ?? 0,
        transferred: row.transferredSize ?? 0,
        withPreBackup: row.withPreBackup,
        withRetention: row.withRetention,
      });
    } else if (row.status === 'failed') {
      logOutput = failLog(row.errorMessage || 'Backup failed');
    }

    return {
      id: nanoid(),
      configId: row.configId,
      startTime: row.start,
      endTime: end,
      status: row.status,
      fileCount: row.fileCount ?? null,
      totalSize: row.totalSize ?? null,
      transferredSize: row.transferredSize ?? null,
      errorMessage: row.errorMessage ?? null,
      logOutput,
    };
  });

  // Insert in chunks to stay friendly to SQLite
  const chunk = 40;
  for (let i = 0; i < historyValues.length; i += chunk) {
    await db.insert(backupHistory).values(historyValues.slice(i, i + chunk));
  }

  // Timezone for sensible "next run" labels in screenshots
  const tzExisting = await db.query.settings.findFirst({
    where: eq(settings.key, 'timezone'),
  });
  if (tzExisting) {
    await db
      .update(settings)
      .set({ value: 'America/Argentina/Buenos_Aires', updatedAt: now })
      .where(eq(settings.key, 'timezone'));
  } else {
    await db.insert(settings).values({
      id: nanoid(),
      key: 'timezone',
      value: 'America/Argentina/Buenos_Aires',
      createdAt: now,
      updatedAt: now,
    });
  }

  return {
    servers: 4,
    backups: 6,
    history: historyValues.length,
    sshKeys: 1,
  };
}
