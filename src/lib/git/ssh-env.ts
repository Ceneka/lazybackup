/**
 * Environment for git network operations.
 *
 * git runs `GIT_SSH_COMMAND` through the shell, so every token is single-quoted:
 * a key path can come from the ssh vault (`privateKeyPath`) and must never be
 * interpolated raw.
 */
import {
  ensureKnownHostsFile,
  getKnownHostsPath,
  sshStrictHostKeyCliOptions,
} from '@/lib/ssh/known-hosts';
import { assertSafeCliToken, assertSshPort, shellSingleQuote } from '@/lib/ssh/rsync';

/**
 * Fail fast on black-holed hosts: without these OpenSSH waits for the kernel
 * TCP timeout and `git ls-remote` hangs for ~2 minutes.
 */
export const SSH_CONNECT_TIMEOUT_SECONDS = 10;
export const SSH_CONNECTION_ATTEMPTS = 1;

export type SshGitCommandOptions = {
  /** SSH port from the URL; git also passes `-p`, this keeps the old explicit form. */
  port?: number;
};

/**
 * Build the `GIT_SSH_COMMAND` string. `knownHostsPath` keeps the app-wide TOFU
 * pinning (`sshStrictHostKeyCliOptions` adds BatchMode + accept-new).
 */
export function buildSshGitCommand(
  keyPath: string | null | undefined,
  knownHostsPath: string,
  options: SshGitCommandOptions = {}
): string {
  const argv = ['ssh'];
  if (options.port !== undefined) {
    argv.push('-p', String(assertSshPort(options.port)));
  }
  argv.push(
    '-o',
    `ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`,
    '-o',
    `ConnectionAttempts=${SSH_CONNECTION_ATTEMPTS}`,
    ...sshStrictHostKeyCliOptions(knownHostsPath)
  );
  if (keyPath) {
    argv.push('-i', assertSafeCliToken(keyPath, 'SSH identity path'), '-F', '/dev/null');
  }
  return argv.map(shellSingleQuote).join(' ');
}

/**
 * Process env with non-interactive git settings and a fast-failing ssh.
 * With a key path, ssh is pinned to that identity and ignores host ssh config.
 */
export async function sshGitEnv(
  keyPath?: string,
  options: SshGitCommandOptions = {}
): Promise<NodeJS.ProcessEnv> {
  // HTTPS remotes never invoke ssh; only an SSH identity needs the pin file.
  const knownHostsPath = keyPath ? await ensureKnownHostsFile() : getKnownHostsPath();
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'echo',
    GIT_SSH_COMMAND: buildSshGitCommand(keyPath, knownHostsPath, options),
  };
}
