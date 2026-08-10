import { findNestedOverlapsInList, findExactConflictInList, type DestinationConflict } from '@/lib/backup/destination';
import { db } from '@/lib/db';

async function listDestinationConfigs() {
  return db.query.backupConfigs.findMany({
    columns: {
      id: true,
      name: true,
      destinationPath: true,
    },
  });
}

export async function findExactDestinationConflict(
  destinationPath: string,
  excludeConfigId?: string
): Promise<DestinationConflict | null> {
  const configs = await listDestinationConfigs();
  return findExactConflictInList(configs, destinationPath, excludeConfigId);
}

export async function findNestedDestinationOverlaps(
  destinationPath: string,
  excludeConfigId?: string
): Promise<DestinationConflict[]> {
  const configs = await listDestinationConfigs();
  return findNestedOverlapsInList(configs, destinationPath, excludeConfigId);
}
