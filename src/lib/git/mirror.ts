import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { writeTemporarySshIdentityFile } from '@/lib/ssh';
import { sshGitEnv } from './ssh-env';

const execFileAsync = promisify(execFile);

/** Connection-only probes (Settings → test): fail in ~20 s on a black-holed host. */
export const GIT_LS_REMOTE_TIMEOUT_MS = 20_000;
/** A full mirror of a large repo can legitimately take minutes. */
export const GIT_CLONE_TIMEOUT_MS = 15 * 60 * 1000;
/** Local plumbing (show-ref) and anything without a specific ceiling. */
export const GIT_DEFAULT_TIMEOUT_MS = 120_000;

export type ParsedGitUrl = {
  scheme: 'ssh' | 'https' | 'http';
  host: string;
  port: number;
  url: string;
};

const SCP_LIKE = /^([A-Za-z0-9._-]+)@([A-Za-z0-9.-]+):(.+)$/;

export function parseGitUrl(raw: string): ParsedGitUrl {
  const url = raw.trim();
  if (!url) {
    throw new Error('Git URL is required');
  }
  if (/[\r\n\0]/.test(url)) {
    throw new Error('Git URL contains invalid characters');
  }

  if (/^https?:\/\//i.test(url)) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid Git URL');
    }
    if (parsed.username || parsed.password) {
      throw new Error('Git HTTPS URLs with embedded credentials are not supported');
    }
    const scheme = parsed.protocol === 'http:' ? 'http' : 'https';
    const port = parsed.port ? Number(parsed.port) : scheme === 'http' ? 80 : 443;
    return { scheme, host: parsed.hostname, port, url };
  }

  if (url.startsWith('ssh://')) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('Invalid Git SSH URL');
    }
    return {
      scheme: 'ssh',
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 22,
      url,
    };
  }

  const scp = url.match(SCP_LIKE);
  if (scp) {
    return {
      scheme: 'ssh',
      host: scp[2],
      port: 22,
      url,
    };
  }

  throw new Error(
    'Unsupported Git URL. Use git@host:org/repo.git, ssh://host/path.git, or https://…'
  );
}

export function gitUrlNeedsSshKey(url: string): boolean {
  return parseGitUrl(url).scheme === 'ssh';
}

export function gitRepoSlug(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  const last = trimmed.split(/[/:]/).filter(Boolean).pop() || 'repo';
  const withoutGit = last.replace(/\.git$/i, '');
  const slug = withoutGit
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'repo';
}

export async function buildGitSshCommand(
  keyContent: string,
  port: number
): Promise<{ command: string; cleanup: () => Promise<void> }> {
  const identity = await writeTemporarySshIdentityFile(keyContent);
  try {
    const env = await sshGitEnv(identity.path, { port });
    return { command: env.GIT_SSH_COMMAND ?? '', cleanup: identity.cleanup };
  } catch (error) {
    await identity.cleanup();
    throw error;
  }
}

/** Identity file + ssh env for SSH remotes; plain env (fast-fail ssh options) otherwise. */
async function prepareGitEnv(
  parsed: ParsedGitUrl,
  keyContent?: string | null
): Promise<{ env: NodeJS.ProcessEnv; cleanup?: () => Promise<void> }> {
  if (parsed.scheme !== 'ssh' || !keyContent?.trim()) {
    return { env: await sshGitEnv() };
  }
  const identity = await writeTemporarySshIdentityFile(keyContent);
  try {
    const env = await sshGitEnv(identity.path, { port: parsed.port });
    return { env, cleanup: identity.cleanup };
  } catch (error) {
    await identity.cleanup();
    throw error;
  }
}

function gitMissingError(error: unknown): Error {
  const err = error as NodeJS.ErrnoException;
  if (err?.code === 'ENOENT') {
    return new Error(
      'git is not installed on this host. Install git, or use the official Docker image.'
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

function gitCommandLabel(args: string[]): string {
  return args[0] === '--git-dir' ? 'git show-ref' : `git ${args[0]}`;
}

/** Timeout used for each kind of git call; keeps the wiring testable without module mocks. */
export function gitCallTimeout(kind: 'ls-remote' | 'clone'): number {
  return kind === 'ls-remote' ? GIT_LS_REMOTE_TIMEOUT_MS : GIT_CLONE_TIMEOUT_MS;
}

/** execFile kills the child on timeout but only reports a signal — explain it. */
export function describeGitRunError(
  error: unknown,
  args: string[],
  timeoutMs: number
): Error {
  const err = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
  if (err?.code === 'ENOENT') {
    return gitMissingError(error);
  }
  const timedOut =
    err?.killed === true || err?.code === 'ETIMEDOUT' || err?.signal === 'SIGTERM';
  if (timedOut) {
    const seconds = Math.max(1, Math.round(timeoutMs / 1000));
    return new Error(
      `${gitCommandLabel(args)} timed out after ${seconds}s — host unreachable?`
    );
  }
  return error instanceof Error ? error : new Error(String(error));
}

const gitRunError = describeGitRunError;

async function runGit(
  args: string[],
  options: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number }
): Promise<{ stdout: string; stderr: string }> {
  const timeoutMs = options.timeoutMs ?? GIT_DEFAULT_TIMEOUT_MS;
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      env: options.env,
      cwd: options.cwd,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout: stdout || '', stderr: stderr || '' };
  } catch (error) {
    throw gitRunError(error, args, timeoutMs);
  }
}

export async function testGitRepo(options: {
  url: string;
  keyContent?: string | null;
}): Promise<{ refCount: number; stdout: string }> {
  const parsed = parseGitUrl(options.url);
  if (parsed.scheme === 'ssh' && !options.keyContent?.trim()) {
    throw new Error('This Git URL needs an SSH key from Settings → SSH keys');
  }

  const { env, cleanup } = await prepareGitEnv(parsed, options.keyContent);
  try {
    const result = await runGit(['ls-remote', '--heads', parsed.url], {
      env,
      timeoutMs: gitCallTimeout('ls-remote'),
    });
    const refCount = result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean).length;
    return { refCount, stdout: result.stdout };
  } finally {
    await cleanup?.();
  }
}

export type GitMirrorPackResult = {
  localPath: string;
  archiveName: string;
  tmpDir: string;
  refCount: number;
};

export async function packGitMirror(options: {
  url: string;
  keyContent?: string | null;
  archiveBaseName: string;
}): Promise<GitMirrorPackResult> {
  const parsed = parseGitUrl(options.url);
  if (parsed.scheme === 'ssh' && !options.keyContent?.trim()) {
    throw new Error('This Git URL needs an SSH key from Settings → SSH keys');
  }

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lazybackup-git-'));
  const mirrorDir = path.join(tmpDir, 'mirror.git');
  const archiveName = `${options.archiveBaseName.replace(/\.tar\.gz$/i, '')}.tar.gz`;
  const localPath = path.join(tmpDir, archiveName);

  const { env, cleanup } = await prepareGitEnv(parsed, options.keyContent);

  try {
    await runGit(['clone', '--mirror', '--quiet', parsed.url, mirrorDir], {
      env,
      timeoutMs: gitCallTimeout('clone'),
    });

    const refs = await runGit(['--git-dir', mirrorDir, 'show-ref'], { env });
    const refCount = refs.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean).length;

    try {
      await execFileAsync('tar', ['-czf', localPath, '-C', tmpDir, 'mirror.git']);
    } catch (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }

    return { localPath, archiveName, tmpDir, refCount };
  } catch (error) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw error instanceof Error ? error : new Error(String(error));
  } finally {
    await cleanup?.();
  }
}
