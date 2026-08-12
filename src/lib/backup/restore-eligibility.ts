export type RestoreEligibilityInput = {
  status?: string | null;
  sourceType?: string | null;
  destinationKind?: string | null;
  artifactPath?: string | null;
};

function isRestorableSourceType(sourceType: string | null | undefined): boolean {
  const t = sourceType || 'path';
  return t === 'docker_volume' || t === 'database';
}

function isRestorableDestination(destinationKind: string | null | undefined): boolean {
  const kind = destinationKind || 'local';
  return kind === 'local' || kind === 's3' || kind === 'peer';
}

/**
 * Whether History UI should offer restore (Docker volume or database dump).
 * Local dest (artifact on disk), S3, or bro peer (download then restore).
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

/** Alias — restore applies to volume and database dumps. */
export const canRestoreBackup = canRestoreDockerVolumeBackup;

/** Explain why restore is unavailable when it is a volume/database backup but still blocked. */
export function restoreBlockedReason(
  input: RestoreEligibilityInput
): string | null {
  const sourceType = input.sourceType || 'path';
  if (!isRestorableSourceType(sourceType)) {
    return null;
  }
  const kindLabel = sourceType === 'database' ? 'database' : 'volume';
  if (input.status !== 'success') {
    return `Only successful ${kindLabel} backups can be restored.`;
  }
  if (!isRestorableDestination(input.destinationKind)) {
    return 'Restore needs the archive on this host, in S3, or on a paired bro — remote SSH destinations are not supported.';
  }
  if (!input.artifactPath) {
    return 'This run has no stored artifact path.';
  }
  return null;
}
