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

/**
 * Whether History UI should offer restore (Docker volume or database dump).
 * Must match restore guards (local dest + artifact on disk).
 */
export function canRestoreDockerVolumeBackup(
  input: RestoreEligibilityInput
): boolean {
  return (
    input.status === 'success' &&
    isRestorableSourceType(input.sourceType) &&
    (input.destinationKind || 'local') === 'local' &&
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
  if ((input.destinationKind || 'local') !== 'local') {
    return 'Restore needs the archive on this host — remote destinations are not supported.';
  }
  if (!input.artifactPath) {
    return 'This run has no stored artifact path.';
  }
  return null;
}
