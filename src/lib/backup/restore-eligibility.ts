export type RestoreEligibilityInput = {
  status?: string | null;
  sourceType?: string | null;
  destinationKind?: string | null;
  artifactPath?: string | null;
  artifactRemoved?: boolean | null;
  /** SSH dest: must be `key` to pull. Password-only dests cannot restore/download. */
  destinationAuthType?: string | null;
};

function isRestorableSourceType(sourceType: string | null | undefined): boolean {
  const t = sourceType || 'path';
  return t === 'docker_volume' || t === 'database' || t === 'path';
}

function isRestorableDestination(input: RestoreEligibilityInput): boolean {
  const kind = input.destinationKind || 'local';
  if (kind === 'local' || kind === 's3' || kind === 'peer') return true;
  if (kind === 'server') return input.destinationAuthType === 'key';
  return false;
}

/** Build eligibility from a history row + nested backupConfig (list/detail/download). */
export function restoreEligibilityFromHistory(entry: {
  status?: string | null;
  artifactPath?: string | null;
  artifactRemoved?: boolean | null;
  backupConfig?: {
    sourceType?: string | null;
    destinationKind?: string | null;
    destinationServer?: { authType?: string | null } | null;
  } | null;
}): RestoreEligibilityInput {
  return {
    status: entry.status,
    sourceType: entry.backupConfig?.sourceType,
    destinationKind: entry.backupConfig?.destinationKind,
    artifactPath: entry.artifactPath,
    artifactRemoved: entry.artifactRemoved,
    destinationAuthType: entry.backupConfig?.destinationServer?.authType,
  };
}

/**
 * Whether History UI should offer restore (path tree, Docker volume, or database dump).
 * Local dest (on disk), S3, bro peer, or SSH dest with key auth (pull then restore).
 */
export function canRestoreDockerVolumeBackup(
  input: RestoreEligibilityInput
): boolean {
  return (
    input.status === 'success' &&
    isRestorableSourceType(input.sourceType) &&
    isRestorableDestination(input) &&
    Boolean(input.artifactPath) &&
    !input.artifactRemoved
  );
}

/** Alias — restore applies to path trees, volume archives, and database dumps. */
export const canRestoreBackup = canRestoreDockerVolumeBackup;

/** Same gate as restore: successful local / S3 / peer / key-auth SSH dest artifact. */
export const canDownloadBackup = canRestoreBackup;

/** Basename for Content-Disposition from a local, s3://, or peer:// artifact path. */
export function downloadFilenameFromArtifactPath(artifactPath: string): string {
  const trimmed = artifactPath.replace(/[/\\]+$/, '');
  const last = trimmed.split(/[/\\]/).filter(Boolean).pop() || 'backup';
  return sanitizeDownloadFilename(last);
}

export function sanitizeDownloadFilename(name: string): string {
  const cleaned = name.replace(/[\r\n"]/g, '').replace(/[/\\]/g, '_').trim();
  return (cleaned || 'backup').slice(0, 200);
}

/** Add .tar.gz when packing a directory tree for download. */
export function downloadFilenameForLocalPath(
  localPath: string,
  isDirectory: boolean
): string {
  const base = downloadFilenameFromArtifactPath(localPath);
  if (
    isDirectory &&
    !base.toLowerCase().endsWith('.tar.gz') &&
    !base.toLowerCase().endsWith('.tgz')
  ) {
    return `${base}.tar.gz`;
  }
  return base;
}

export function contentDispositionAttachment(filename: string): string {
  return `attachment; filename="${sanitizeDownloadFilename(filename)}"`;
}

export const SSH_DEST_RESTORE_NEEDS_KEY =
  'Restore from this SSH destination needs key authentication on the dest server (password-only cannot pull the artifact).';

/** Explain why restore is unavailable when it is a restorable source type but still blocked. */
export function restoreBlockedReason(
  input: RestoreEligibilityInput
): string | null {
  const sourceType = input.sourceType || 'path';
  if (!isRestorableSourceType(sourceType)) {
    return null;
  }
  const kindLabel =
    sourceType === 'database'
      ? 'database'
      : sourceType === 'docker_volume'
        ? 'volume'
        : 'path';
  if (input.status !== 'success') {
    return `Only successful ${kindLabel} backups can be restored.`;
  }
  if (!isRestorableDestination(input)) {
    if ((input.destinationKind || 'local') === 'server') {
      if (input.destinationAuthType === 'password') {
        return SSH_DEST_RESTORE_NEEDS_KEY;
      }
      return 'Restore needs the destination server to pull the artifact.';
    }
    return 'Restore needs the artifact on this host, in S3, on a paired bro, or on an SSH destination with key auth.';
  }
  if (!input.artifactPath) {
    return 'This run has no stored artifact path.';
  }
  if (input.artifactRemoved) {
    return 'artifact removed by retention';
  }
  return null;
}
