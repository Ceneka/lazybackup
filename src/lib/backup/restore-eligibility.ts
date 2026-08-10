export type RestoreEligibilityInput = {
  status?: string | null;
  sourceType?: string | null;
  destinationKind?: string | null;
  artifactPath?: string | null;
};

/**
 * Whether History UI should offer Docker volume restore.
 * Must match restoreDockerVolumeBackup guards (local dest + artifact on disk).
 */
export function canRestoreDockerVolumeBackup(
  input: RestoreEligibilityInput
): boolean {
  return (
    input.status === 'success' &&
    (input.sourceType || 'path') === 'docker_volume' &&
    (input.destinationKind || 'local') === 'local' &&
    Boolean(input.artifactPath)
  );
}

/** Explain why restore is unavailable when it is a volume backup but still blocked. */
export function restoreBlockedReason(
  input: RestoreEligibilityInput
): string | null {
  if ((input.sourceType || 'path') !== 'docker_volume') {
    return null;
  }
  if (input.status !== 'success') {
    return 'Only successful volume backups can be restored.';
  }
  if ((input.destinationKind || 'local') !== 'local') {
    return 'Restore needs the archive on this host — remote destinations are not supported.';
  }
  if (!input.artifactPath) {
    return 'This run has no stored artifact path.';
  }
  return null;
}
