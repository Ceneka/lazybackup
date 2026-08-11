import {
  findNestedOverlapsInList,
  findExactConflictInList,
  type DestinationConflict,
  type EndpointKind,
} from '@/lib/backup/destination';
import { db } from '@/lib/db';

async function listDestinationConfigs() {
  return db.query.backupConfigs.findMany({
    columns: {
      id: true,
      name: true,
      destinationPath: true,
      destinationKind: true,
      destinationServerId: true,
      destinationS3ProfileId: true,
    },
  });
}

export async function findExactDestinationConflict(
  destinationPath: string,
  excludeConfigId?: string,
  options?: {
    destinationKind?: EndpointKind | null;
    destinationServerId?: string | null;
    destinationS3ProfileId?: string | null;
  }
): Promise<DestinationConflict | null> {
  const configs = await listDestinationConfigs();
  return findExactConflictInList(configs, destinationPath, excludeConfigId, options);
}

export async function findNestedDestinationOverlaps(
  destinationPath: string,
  excludeConfigId?: string,
  options?: {
    destinationKind?: EndpointKind | null;
    destinationServerId?: string | null;
    destinationS3ProfileId?: string | null;
  }
): Promise<DestinationConflict[]> {
  const configs = await listDestinationConfigs();
  return findNestedOverlapsInList(configs, destinationPath, excludeConfigId, options);
}
