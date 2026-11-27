import { remotePathShellWord, shellSingleQuote } from '@/lib/ssh/rsync';

export type RemotePathKind = 'dir' | 'file' | 'missing';

/**
 * Remote shell command that classifies a path without breaking on quotes/spaces.
 * The path is expanded through remotePathShellWord (so `~/…` means $HOME, as it
 * does for rsync/scp) inside a single-quoted script, then the whole script is
 * single-quoted for a POSIX login shell.
 *
 * Must not require bash: minimal targets (Alpine/BusyBox, which is exactly what
 * Docker hosts tend to be) have no bash, and the probe would then report a
 * perfectly good artifact as missing.
 */
export function buildRemotePathKindCommand(remotePath: string): string {
  const script = `p=${remotePathShellWord(remotePath)}; if test -d "$p"; then echo dir; elif test -e "$p"; then echo file; else echo missing; fi`;
  return `sh -lc ${shellSingleQuote(script)}`;
}

export function parseRemotePathKind(stdout: string | null | undefined): RemotePathKind {
  const kind = (stdout || '').trim();
  return kind === 'dir' || kind === 'file' ? kind : 'missing';
}

/** Remote check used by validation: path exists, or its parent is writable. */
export function buildRemoteDestWritableCommand(destPath: string): string {
  const script = `p=${remotePathShellWord(destPath)}; d=$(dirname -- "$p"); test -d "$p" || test -w "$d"`;
  return `sh -lc ${shellSingleQuote(script)}`;
}
