import { db } from '@/lib/db';
import { backupHistory } from '@/lib/db/schema';
import { eq, inArray } from 'drizzle-orm';

/** Why a history row's artifact no longer exists at the destination. */
export const ARTIFACT_REMOVED_BY_VERSION_RETENTION = 'removed by version retention';
export const ARTIFACT_REMOVED_BY_FILE_RETENTION = 'removed by file retention';

/** True when `artifactPath` is exactly `deletedPath` or lives inside it. */
export function artifactPathMatchesDeletedPath(
  artifactPath: string,
  deletedPath: string
): boolean {
  const artifact = artifactPath.replace(/\/+$/, '');
  const deleted = deletedPath.replace(/\/+$/, '');
  if (!artifact || !deleted) return false;
  return artifact === deleted || artifact.startsWith(`${deleted}/`);
}

/** History row ids whose artifact was (or is inside) one of the deleted paths. */
export function selectHistoryIdsRemovedByPaths(
  rows: ReadonlyArray<{ id: string; artifactPath?: string | null }>,
  deletedPaths: readonly string[]
): string[] {
  const paths = deletedPaths.map((path) => path.trim()).filter(Boolean);
  if (paths.length === 0) return [];
  return rows
    .filter(
      (row) =>
        row.artifactPath &&
        paths.some((deleted) => artifactPathMatchesDeletedPath(row.artifactPath!, deleted))
    )
    .map((row) => row.id);
}

/**
 * Flag history rows whose artifact retention just deleted so restore/download
 * reports "removed by retention" instead of "artifact not found".
 * Retention is best-effort: failures are logged, never thrown.
 */
export async function markArtifactsRemoved(
  configId: string,
  deletedPaths: readonly string[],
  reason: string
): Promise<number> {
  if (deletedPaths.length === 0) return 0;
  try {
    const rows = await db.query.backupHistory.findMany({
      where: eq(backupHistory.configId, configId),
      columns: { id: true, artifactPath: true },
    });
    const ids = selectHistoryIdsRemovedByPaths(rows, deletedPaths);
    if (ids.length === 0) return 0;

    await db
      .update(backupHistory)
      .set({ artifactRemoved: true, artifactRemovedReason: reason })
      .where(inArray(backupHistory.id, ids));
    return ids.length;
  } catch (error) {
    console.warn(`Failed to mark artifacts removed by retention: ${error}`);
    return 0;
  }
}
