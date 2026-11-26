/**
 * Relational `with` for history APIs: nested endpoints are column-allowlisted
 * so SSH passwords, private keys, and S3 secrets never leave the query.
 * Backup-config secrets (dbPassword, instanceBackupPassphrase) are excluded.
 */

const publicServerColumns = {
  id: true,
  name: true,
  host: true,
  port: true,
  username: true,
  authType: true,
} as const;

const publicS3Columns = {
  id: true,
  name: true,
  endpoint: true,
  region: true,
  bucket: true,
  forcePathStyle: true,
} as const;

const publicGitRepoColumns = {
  id: true,
  name: true,
  url: true,
} as const;

/** Bro destination info for delivery state; never tokens or hashes. */
export const publicPeerColumns = {
  id: true,
  name: true,
  remoteBaseUrl: true,
  status: true,
  lastSeenAt: true,
  remoteUsedBytes: true,
  remoteQuotaBytes: true,
  remoteLastError: true,
  remoteLastSyncAt: true,
  remoteAppVersion: true,
  remoteReportedAt: true,
} as const;

export const historyBackupConfigWith = {
  columns: {
    dbPassword: false,
    instanceBackupPassphrase: false,
  },
  with: {
    server: { columns: publicServerColumns },
    destinationServer: { columns: publicServerColumns },
    sourceS3Profile: { columns: publicS3Columns },
    destinationS3Profile: { columns: publicS3Columns },
    sourceGitRepo: { columns: publicGitRepoColumns },
    destinationPeer: { columns: publicPeerColumns },
  },
} as const;
