/**
 * Utility functions for building rsync/scp argv (never interpolate into a shell).
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { assertSafePathString } from '@/lib/backup/local-paths';
import { ensureKnownHostsFile, sshStrictHostKeyCliOptions } from './known-hosts';

const execFileAsync = promisify(execFile);

/** Safe single-quoted string for use inside `sh -c` / remote SSH commands */
export function shellSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function assertSafeCliToken(value: string, label: string): string {
  return assertSafePathString(value, label);
}

export function assertSshPort(port: number): number {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error('Invalid SSH port');
  }
  return n;
}

export function sshUserHost(username: string, host: string): string {
  assertSafeCliToken(username, 'SSH username');
  assertSafeCliToken(host, 'SSH host');
  if (username.includes('@') || /[\s:]/.test(username) || /[\s]/.test(host)) {
    throw new Error('Invalid SSH username or host');
  }
  return `${username}@${host}`;
}

export async function sshCliArgv(options: {
  port: number;
  keyPath: string;
}): Promise<string[]> {
  const port = assertSshPort(options.port);
  assertSafeCliToken(options.keyPath, 'SSH identity path');
  const knownHostsPath = await ensureKnownHostsFile();
  return [
    'ssh',
    '-p',
    String(port),
    '-i',
    options.keyPath,
    '-F',
    '/dev/null',
    ...sshStrictHostKeyCliOptions(knownHostsPath),
  ];
}

/** rsync `-e` takes a single command string; quote args that need it. */
export function formatRshArgument(sshArgv: string[]): string {
  return sshArgv
    .map((a) => (/[\s"']/.test(a) ? shellSingleQuote(a) : a))
    .join(' ');
}

export function buildRsyncArgv(options: {
  sourcePath: string;
  destinationPath: string;
  excludePatterns?: string[];
  additionalOptions?: string[];
  rsh?: string;
}): string[] {
  const sourcePath = assertSafeCliToken(options.sourcePath, 'Source path');
  const destinationPath = assertSafeCliToken(options.destinationPath, 'Destination path');
  const args = ['-avz', '--stats', '--safe-links'];
  if (options.rsh) {
    args.push('-e', options.rsh);
  }
  if (options.additionalOptions?.length) {
    for (const opt of options.additionalOptions) {
      assertSafeCliToken(opt, 'rsync option');
      args.push(opt);
    }
  }
  for (const pattern of options.excludePatterns || []) {
    assertSafeCliToken(pattern, 'Exclude pattern');
    args.push(`--exclude=${pattern}`);
  }
  args.push(sourcePath, destinationPath);
  return args;
}

/**
 * Remote-shell rsync command: every interpolated value is single-quoted.
 * Prefer {@link runRsync} / {@link buildRsyncArgv} on the LazyBackup host.
 */
export function buildRsyncCommand(
  sourcePath: string,
  destinationPath: string,
  excludePatterns: string[] = [],
  additionalOptions: string[] = [],
  rshShell?: string
): string {
  const argv = buildRsyncArgv({
    sourcePath,
    destinationPath,
    excludePatterns,
    additionalOptions,
    rsh: rshShell,
  });
  return ['rsync', ...argv.map(shellSingleQuote)].join(' ');
}

export async function runRsync(
  argv: string[],
  options?: { maxBuffer?: number }
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('rsync', argv, {
    maxBuffer: options?.maxBuffer ?? 32 * 1024 * 1024,
  });
  return { stdout: stdout || '', stderr: stderr || '' };
}

export function buildScpArgv(options: {
  port: number;
  keyPath: string;
  knownHostsPath: string;
  recursive?: boolean;
}): string[] {
  const port = assertSshPort(options.port);
  assertSafeCliToken(options.keyPath, 'SSH identity path');
  const args = [
    '-P',
    String(port),
    '-F',
    '/dev/null',
    '-i',
    options.keyPath,
    ...sshStrictHostKeyCliOptions(options.knownHostsPath),
  ];
  if (options.recursive) {
    args.push('-r');
  }
  return args;
}

export async function runScp(
  argv: string[],
  options?: { maxBuffer?: number }
): Promise<{ stdout: string; stderr: string }> {
  const { stdout, stderr } = await execFileAsync('scp', argv, {
    maxBuffer: options?.maxBuffer ?? 32 * 1024 * 1024,
  });
  return { stdout: stdout || '', stderr: stderr || '' };
}

/**
 * Remote `find` listing relative paths under remotePath (no shell interpolation).
 * Uses `cd` + `find .` so results are relative (not absolute) and excludes are quoted.
 */
export function buildFindCommand(remotePath: string, excludePatterns: string[] = []): string {
  assertSafeCliToken(remotePath, 'Remote path');
  const quoted = shellSingleQuote(remotePath);
  const pruneParts: string[] = [];
  for (const pattern of excludePatterns) {
    assertSafeCliToken(pattern, 'Exclude pattern');
    const rel = pattern.replace(/^\.\//, '');
    pruneParts.push(`-path ${shellSingleQuote(`./${rel}`)} -prune -o`);
  }
  const prune = pruneParts.length ? `${pruneParts.join(' ')} ` : '';
  return `cd ${quoted} && find . ${prune}-type f -print`;
}
