export type RestoreEligibilityInput = {
  status?: string | null;
  sourceType?: string | null;
  destinationKind?: string | null;
  artifactPath?: string | null;
};

function isRestorableSourceType(sourceType: string | null | undefined): boolean {
  const t = sourceType || 'path';
  return t === 'docker_volume' || t === 'database' || t === 'path';
}

function isRestorableDestination(destinationKind: string | null | undefined): boolean {
  const kind = destinationKind || 'local';
  return kind === 'local' || kind === 's3' || kind === 'peer';
}

/**
 * Whether History UI should offer restore (path tree, Docker volume, or database dump).
 * Local dest (on disk), S3, or bro peer (download then restore).
 * Destination on a remote SSH server is not supported (artifact is not on this host).
 */
export function canRestoreDockerVolumeBackup(
  input: RestoreEligibilityInput
): boolean {
  return (
    input.status === 'success' &&
    isRestorableSourceType(input.sourceType) &&
    isRestorableDestination(input.destinationKind) &&
    Boolean(input.artifactPath)
  );
}

/** Alias — restore applies to path trees, volume archives, and database dumps. */
export const canRestoreBackup = canRestoreDockerVolumeBackup;

/** Same gate as restore: successful local / S3 / peer artifact. */
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
  if (!isRestorableDestination(input.destinationKind)) {
    return 'Restore needs the artifact on this host, in S3, or on a paired bro — remote SSH destinations are not supported.';
  }
  if (!input.artifactPath) {
    return 'This run has no stored artifact path.';
  }
  return null;
}
