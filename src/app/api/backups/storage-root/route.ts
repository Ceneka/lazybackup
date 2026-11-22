import {
  allowArbitraryLocalPaths,
  getAllowedLocalStorageRoots,
} from '@/lib/backup/local-paths';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/backups/storage-root — effective local storage root for the form's
 * destination suggestion and out-of-root warning.
 *
 * The value comes from BACKUP_STORAGE_PATH on the server; client components
 * cannot read that env var. Auth is enforced by the normal middleware.
 */
export async function GET() {
  try {
    const allowedRoots = getAllowedLocalStorageRoots();
    // Prefer the /backups convention when it is an allowed root (Docker and the
    // default relative path add it), otherwise use the configured root.
    const storageRoot = allowedRoots.includes('/backups')
      ? '/backups'
      : allowedRoots[0] || '/backups';
    return NextResponse.json({
      storageRoot,
      allowedRoots,
      allowArbitraryLocalPaths: allowArbitraryLocalPaths(),
    });
  } catch (error) {
    console.error('Failed to resolve backup storage root:', error);
    return NextResponse.json(
      { error: 'Failed to resolve backup storage root' },
      { status: 500 }
    );
  }
}
