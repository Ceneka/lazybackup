export type RetentionAgeUnit = 'days' | 'months';

export type FileCandidate = {
  name: string;
  mtimeMs: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function maxAgeToMs(maxAge: number, unit: RetentionAgeUnit): number {
  if (unit === 'months') {
    return maxAge * 30 * DAY_MS;
  }
  return maxAge * DAY_MS;
}

/**
 * Returns names of top-level files that should be deleted:
 * keep the newest `minKeep` files always; among the rest, delete those older than max age.
 */
export function selectFilesToDelete(
  files: FileCandidate[],
  options: {
    maxAge: number;
    unit: RetentionAgeUnit;
    minKeep: number;
    nowMs?: number;
  }
): string[] {
  const minKeep = Math.max(0, options.minKeep);
  const now = options.nowMs ?? Date.now();
  const cutoff = now - maxAgeToMs(options.maxAge, options.unit);

  const sortedNewestFirst = [...files].sort((a, b) => b.mtimeMs - a.mtimeMs);
  const protectedNames = new Set(
    sortedNewestFirst.slice(0, minKeep).map((file) => file.name)
  );

  return sortedNewestFirst
    .filter((file) => !protectedNames.has(file.name) && file.mtimeMs < cutoff)
    .map((file) => file.name);
}
