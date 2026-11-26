import { remotePathShellWord, shellSingleQuote } from '@/lib/ssh/rsync';

export type RemotePathKind = 'dir' | 'file' | 'missing';

/**
 * Remote shell command that classifies a path without breaking on quotes/spaces.
 * The path is expanded through remotePathShellWord (so `~/…` means $HOME, as it
 * does for rsync/scp) inside a single-quoted script, then the whole script is
 * single-quoted for `bash -lc`.
 */
export function buildRemotePathKindCommand(remotePath: string): string {
  const script = `p=${remotePathShellWord(remotePath)}; if test -d "$p"; then echo dir; elif test -e "$p"; then echo file; else echo missing; fi`;
  return `bash -lc ${shellSingleQuote(script)}`;
}

export function parseRemotePathKind(stdout: string | null | undefined): RemotePathKind {
  const kind = (stdout || '').trim();
  return kind === 'dir' || kind === 'file' ? kind : 'missing';
}

/** Remote check used by validation: path exists, or its parent is writable. */
export function buildRemoteDestWritableCommand(destPath: string): string {
  const script = `p=${remotePathShellWord(destPath)}; d=$(dirname -- "$p"); test -d "$p" || test -w "$d"`;
  return `bash -lc ${shellSingleQuote(script)}`;
}
