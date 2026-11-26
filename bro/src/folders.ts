import fsSync from 'fs';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { BroConfig } from './config';

export type FolderSuggestion = {
  path: string;
  label: string;
  freeBytes: number | null;
  totalBytes: number | null;
  exists: boolean;
  writable: boolean;
  current: boolean;
};

export type FolderCandidate = {
  path: string;
  label: string;
  kind: 'current' | 'suggested' | 'home' | 'documents' | 'desktop' | 'mount';
};

/** Clear, actionable message for bug B8 (silent share-folder change). */
export function shareDirLockedMessage(current: string): string {
  return `You already have backups in ${current}. Disconnect first, or move your folder manually.`;
}

/**
 * A share-folder change is only allowed while nothing is stored: moving the
 * folder without moving the objects makes acknowledged backups unreachable.
 */
export function shareDirChangeError(
  current: string,
  next: string,
  storedObjectCount: number
): string | null {
  if (!next.trim()) return 'Choose a folder first.';
  if (path.resolve(current) === path.resolve(expandHome(next))) return null;
  if (storedObjectCount > 0) return shareDirLockedMessage(current);
  return null;
}

export function expandHome(input: string): string {
  const trimmed = input.trim();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    return path.join(os.homedir(), trimmed.slice(2));
  }
  return trimmed;
}

/**
 * Validate + create a share folder. Returns the normalized absolute path.
 * Rejects relative paths and filesystem roots: sharing "/" is never intended
 * and makes a bad screenshot.
 */
export async function prepareShareDir(
  input: string,
  options: { home?: string } = {}
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const expanded = expandHome(input);
  if (!expanded) return { ok: false, error: 'Choose a folder first.' };
  if (!path.isAbsolute(expanded)) {
    return {
      ok: false,
      error: 'Use the full path to a folder, for example /home/you/LazyBro Share.',
    };
  }
  const resolved = path.resolve(expanded);
  if (resolved === path.parse(resolved).root) {
    return { ok: false, error: "Choose a folder that isn't your whole disk." };
  }
  try {
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) return { ok: false, error: 'That path is a file, not a folder.' };
  } catch {
    try {
      await fs.mkdir(resolved, { recursive: true, mode: 0o700 });
    } catch {
      return {
        ok: false,
        error: "LazyBro can't create that folder. Pick a folder you can write to.",
      };
    }
  }
  try {
    await fs.mkdir(path.join(resolved, 'objects'), { recursive: true, mode: 0o700 });
    await fs.access(resolved, fsSync.constants.W_OK);
  } catch {
    return { ok: false, error: "LazyBro can't write to that folder. Pick another one." };
  }
  return { ok: true, path: resolved };
}

async function nearestExistingAncestor(input: string): Promise<string | null> {
  let current = path.resolve(input);
  while (true) {
    try {
      const stat = await fs.stat(current);
      return stat.isDirectory() ? current : path.dirname(current);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }
}

export function folderCandidateSpecs(options: {
  home: string;
  current?: string | null;
  mounts?: string[];
}): FolderCandidate[] {
  const home = options.home;
  const specs: FolderCandidate[] = [];
  if (options.current) {
    specs.push({ path: options.current, label: 'Current folder', kind: 'current' });
  }
  specs.push({
    path: path.join(home, 'LazyBro Share'),
    label: 'New folder',
    kind: 'suggested',
  });
  specs.push({ path: path.join(home, 'Documents'), label: 'Documents', kind: 'documents' });
  specs.push({ path: path.join(home, 'Desktop'), label: 'Desktop', kind: 'desktop' });
  specs.push({ path: home, label: 'Home folder', kind: 'home' });
  for (const mount of options.mounts || []) {
    specs.push({ path: mount, label: path.basename(mount) || mount, kind: 'mount' });
  }
  const seen = new Set<string>();
  return specs.filter((spec) => {
    const key = path.resolve(spec.path);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Mount roots a friend could plausibly pick (best effort, never throws). */
export async function discoverMountRoots(
  platform: NodeJS.Platform | string = process.platform,
  home: string = os.homedir()
): Promise<string[]> {
  const roots: string[] = [];
  const addChildren = async (dir: string, depth: number) => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries.slice(0, 20)) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const full = path.join(dir, entry.name);
        if (depth > 1) {
          await addChildren(full, depth - 1);
        } else {
          try {
            if ((await fs.stat(full)).isDirectory()) roots.push(full);
          } catch {
            /* dangling symlink */
          }
        }
      }
    } catch {
      /* not present */
    }
  };
  if (platform === 'darwin') {
    await addChildren('/Volumes', 1);
  } else if (platform === 'linux') {
    const user = path.basename(home);
    // Removable/external disks only: /mnt holds admin mounts (databases, RAID
    // arrays) that a non-technical friend should never be offered.
    await addChildren('/media', 2);
    await addChildren(`/run/media/${user}`, 1);
  }
  return roots;
}

export async function listFolderSuggestions(
  cfg: BroConfig,
  options: {
    home?: string;
    mounts?: string[];
    platform?: NodeJS.Platform | string;
  } = {}
): Promise<FolderSuggestion[]> {
  const home = options.home || os.homedir();
  const mounts =
    options.mounts ??
    (await discoverMountRoots(options.platform || process.platform, home));
  const specs = folderCandidateSpecs({
    home,
    current: cfg.shareDir,
    mounts,
  });
  return Promise.all(
    specs.map((spec) => {
      const resolved = path.resolve(spec.path);
      return describeFolder(resolved, spec.label, resolved === path.resolve(cfg.shareDir));
    })
  );
}

export async function describeFolder(
  folderPath: string,
  label: string,
  current: boolean
): Promise<FolderSuggestion> {
  const resolved = path.resolve(folderPath);
  let exists = false;
  try {
    exists = (await fs.stat(resolved)).isDirectory();
  } catch {
    exists = false;
  }
  let writable = false;
  try {
    await fs.access(exists ? resolved : path.dirname(resolved), fsSync.constants.W_OK);
    writable = true;
  } catch {
    writable = false;
  }
  let freeBytes: number | null = null;
  let totalBytes: number | null = null;
  const target = exists ? resolved : await nearestExistingAncestor(resolved);
  if (target) {
    try {
      const stats = await fs.statfs(target);
      const blockSize = Number(stats.bsize);
      freeBytes = Number(stats.bavail) * blockSize;
      totalBytes = Number(stats.blocks) * blockSize;
      if (!Number.isFinite(freeBytes) || freeBytes < 0) freeBytes = null;
      if (!Number.isFinite(totalBytes) || totalBytes < 0) totalBytes = null;
    } catch {
      freeBytes = null;
      totalBytes = null;
    }
  }
  return { path: resolved, label, freeBytes, totalBytes, exists, writable, current };
}
