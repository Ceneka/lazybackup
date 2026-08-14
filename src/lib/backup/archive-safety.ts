import path from 'path';
import { createReadStream } from 'fs';
import { createGunzip } from 'zlib';
import { extract, type Headers } from 'tar-stream';

const MAX_ARCHIVE_MEMBERS = 500_000;
const MAX_MEMBER_METADATA_BYTES = 20 * 1024 * 1024;

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

function tarMemberType(type: Headers['type']): string {
  if (type === 'file' || type === 'contiguous-file') return '-';
  if (type === 'directory') return 'd';
  if (type === 'symlink') return 'l';
  if (type === 'link') return 'h';
  return type ?? 'unknown';
}

async function readTarGzMembers(archivePath: string): Promise<TarMember[]> {
  return new Promise((resolve, reject) => {
    const members: TarMember[] = [];
    let metadataBytes = 0;
    let settled = false;
    const source = createReadStream(archivePath);
    const gunzip = createGunzip();
    const parser = extract();

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      source.destroy();
      gunzip.destroy();
      parser.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    source.on('error', fail);
    gunzip.on('error', fail);
    parser.on('error', fail);
    parser.on('entry', (header, stream, next) => {
      const member: TarMember = {
        type: tarMemberType(header.type),
        name: header.name,
        linkTarget: header.linkname ?? undefined,
      };
      members.push(member);
      metadataBytes += Buffer.byteLength(member.name);
      if (member.linkTarget) metadataBytes += Buffer.byteLength(member.linkTarget);
      if (
        members.length > MAX_ARCHIVE_MEMBERS ||
        metadataBytes > MAX_MEMBER_METADATA_BYTES
      ) {
        const error = new Error('Unsafe tar archive: member metadata limit exceeded');
        stream.destroy(error);
        next(error);
        fail(error);
        return;
      }
      stream.on('error', fail);
      stream.on('end', next);
      stream.resume();
    });
    parser.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve(members);
    });

    source.pipe(gunzip).pipe(parser);
  });
}

export async function assertSafeTarGzArchive(archivePath: string): Promise<void> {
  let members: TarMember[];
  try {
    members = await readTarGzMembers(archivePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to safely inspect tar archive: ${message}`);
  }
  validateTarMembers(members);
}
