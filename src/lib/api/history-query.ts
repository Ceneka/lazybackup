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
  },
} as const;
