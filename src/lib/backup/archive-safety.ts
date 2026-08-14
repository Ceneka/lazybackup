import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export type TarMember = {
  type: string;
  name: string;
  linkTarget?: string;
};

function safeArchivePath(raw: string, label: string): string {
  if (!raw || raw.includes('\0') || raw.includes('\\')) {
    throw new Error(`Unsafe tar ${label}: invalid path encoding`);
  }
  if (path.posix.isAbsolute(raw)) {
    throw new Error(`Unsafe tar ${label}: absolute path "${raw}"`);
  }
  const normalized = path.posix.normalize(raw.replace(/^\.\//, ''));
  if (
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.split('/').includes('..')
  ) {
    throw new Error(`Unsafe tar ${label}: path traversal "${raw}"`);
  }
  return normalized;
}

export function validateTarMembers(members: TarMember[]): void {
  const names = new Set<string>();
  for (const member of members) {
    if (!['-', 'd', 'l', 'h'].includes(member.type)) {
      throw new Error(`Unsafe tar member "${member.name}": unsupported type`);
    }
    const name = safeArchivePath(member.name, 'member');
    if (name === '.') continue;
    names.add(name.replace(/\/+$/, ''));

    if (member.type === 'l') {
      if (member.linkTarget == null) {
        throw new Error(`Unsafe tar symlink "${member.name}": target is missing`);
      }
      const target = member.linkTarget;
      if (path.posix.isAbsolute(target)) {
        throw new Error(`Unsafe tar symlink "${member.name}": absolute target`);
      }
      safeArchivePath(path.posix.join(path.posix.dirname(name), target), 'symlink target');
    } else if (member.type === 'h') {
      if (member.linkTarget == null) {
        throw new Error(`Unsafe tar hardlink "${member.name}": target is missing`);
      }
      safeArchivePath(member.linkTarget, 'hardlink target');
    }
  }

  for (const member of members) {
    if (member.type !== 'h' || member.linkTarget == null) continue;
    const target = safeArchivePath(member.linkTarget, 'hardlink target').replace(/\/+$/, '');
    if (!names.has(target)) {
      throw new Error(
        `Unsafe tar hardlink "${member.name}": target "${member.linkTarget}" is not in archive`
      );
    }
  }
}

export function parseTarVerboseListing(listing: string): TarMember[] {
  const members: TarMember[] = [];
  for (const line of listing.split(/\r?\n/)) {
    if (!line) continue;
    const match =
      /^(\S)\S*\s+\S+\s+\d+\s+\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s+[+-]\d{4})?\s+([\s\S]+)$/.exec(
        line
      );
    if (!match) {
      throw new Error('Unable to safely inspect tar archive member metadata');
    }
    const type = match[1]!;
    let name = match[2]!;
    let linkTarget: string | undefined;
    if (type === 'l') {
      const split = name.lastIndexOf(' -> ');
      if (split < 0) throw new Error('Unable to inspect tar symlink target');
      linkTarget = name.slice(split + 4);
      name = name.slice(0, split);
    } else if (type === 'h') {
      const split = name.lastIndexOf(' link to ');
      if (split < 0) throw new Error('Unable to inspect tar hardlink target');
      linkTarget = name.slice(split + 9);
      name = name.slice(0, split);
    }
    members.push({ type, name, linkTarget });
  }
  return members;
}

export async function assertSafeTarGzArchive(archivePath: string): Promise<void> {
  const { stdout } = await execFileAsync(
    'tar',
    [
      '--list',
      '--verbose',
      '--gzip',
      '--absolute-names',
      '--numeric-owner',
      '--full-time',
      '--quoting-style=escape',
      '--file',
      archivePath,
    ],
    {
      maxBuffer: 20 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C' },
    }
  );
  const members = parseTarVerboseListing(stdout);
  validateTarMembers(members);
}
