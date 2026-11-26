import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

/**
 * Version folder names: `YYYY-MM-DD_HH-mm-ss` plus an optional collision
 * suffix (`-2`, `-3`, …) when the same second is reused (parallel runs,
 * DST fall-back).
 */
export const VERSION_DIR_PATTERN =
  /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(?:-\d+)?$/;

export const VERSION_DIR_BASE_PATTERN =
  /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})(?:-(\d+))?$/;

export type ParsedVersionDirName = {
  /** YYYY-MM-DD_HH-mm-ss */
  base: string;
  /** 1 for the unsuffixed folder, 2+ for `-2`, `-3`, … */
  ordinal: number;
};

export function parseVersionDirName(name: string): ParsedVersionDirName | null {
  const match = VERSION_DIR_BASE_PATTERN.exec(name);
  if (!match?.[1]) return null;
  const parsedOrdinal = match[2] ? Number(match[2]) : 1;
  return {
    base: match[1],
    ordinal: Number.isSafeInteger(parsedOrdinal) && parsedOrdinal > 0 ? parsedOrdinal : 1,
  };
}

/** Name for the `ordinal`-th version folder created in the same second. */
export function formatVersionDirName(timestamp: string, ordinal = 1): string {
  return ordinal > 1 ? `${timestamp}-${ordinal}` : timestamp;
}

/**
 * Ascending chronological order. Falls back to a plain string compare for
 * names that do not look like version folders.
 */
export function compareVersionDirNames(a: string, b: string): number {
  const parsedA = parseVersionDirName(a);
  const parsedB = parseVersionDirName(b);
  if (!parsedA || !parsedB) return a.localeCompare(b);
  if (parsedA.base !== parsedB.base) return parsedA.base < parsedB.base ? -1 : 1;
  return parsedA.ordinal - parsedB.ordinal;
}

/** Names to delete when keeping the newest `versionsToKeep` version folders. */
export function selectVersionDirNamesToDelete(
  names: readonly string[],
  versionsToKeep: number
): string[] {
  const keep = Math.max(0, versionsToKeep);
  const versionNames = names.filter((name) => parseVersionDirName(name) !== null);
  if (versionNames.length <= keep) return [];
  return [...versionNames]
    .sort(compareVersionDirNames)
    .reverse()
    .slice(keep);
}

function expandHome(value: string): string {
  if (!value.startsWith('~')) return value;
  return value.replace(/^~(?=\/|$)/, process.env.HOME || os.homedir());
}

/**
 * Create a new version folder under `baseDir`, appending `-2`, `-3`, … when a
 * folder for the same second already exists. `mkdir` (not `-p`) is the
 * existence check, so two concurrent runs cannot pick the same name.
 */
export async function createUniqueLocalVersionDir(
  baseDir: string,
  timestamp: string
): Promise<string> {
  const expandedBase = path.resolve(expandHome(baseDir));
  await fs.mkdir(expandedBase, { recursive: true });

  for (let ordinal = 1; ordinal <= 10_000; ordinal += 1) {
    const candidate = path.join(expandedBase, formatVersionDirName(timestamp, ordinal));
    try {
      await fs.mkdir(candidate);
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue;
      throw error;
    }
  }

  throw new Error(
    `Could not allocate a unique backup version folder under ${expandedBase} for ${timestamp}`
  );
}

/**
 * Delete local version folders beyond `versionsToKeep`. Returns the deleted
 * absolute paths so callers can flag their history rows as removed.
 */
export async function cleanupLocalVersionDirs(
  baseDir: string,
  versionsToKeep: number
): Promise<string[]> {
  try {
    const expandedBaseDir = path.resolve(expandHome(baseDir));
    const exists = await fs
      .access(expandedBaseDir)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      console.log(`Directory does not exist, skipping cleanup: ${expandedBaseDir}`);
      return [];
    }

    const entries = await fs.readdir(expandedBaseDir, { withFileTypes: true });
    const versionDirs = entries
      .filter((entry) => entry.isDirectory() && parseVersionDirName(entry.name) !== null)
      .map((entry) => entry.name);

    const toDelete = selectVersionDirNamesToDelete(versionDirs, versionsToKeep);
    const deleted: string[] = [];

    for (const dir of toDelete) {
      const fullPath = path.join(expandedBaseDir, dir);
      console.log(`Deleting old backup version: ${dir}`);
      await fs.rm(fullPath, { recursive: true, force: true });
      deleted.push(fullPath);
    }

    return deleted;
  } catch (error) {
    console.error(`Error cleaning up old backup versions: ${error}`);
    return [];
  }
}
