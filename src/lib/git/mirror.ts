import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { promisify } from 'util';
import { formatRshArgument, sshCliArgv } from '@/lib/ssh/rsync';
import { writeTemporarySshIdentityFile } from '@/lib/ssh';

const execFileAsync = promisify(execFile);

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
  const argv = await sshCliArgv({ port, keyPath: identity.path });
  return {
    command: formatRshArgument(argv),
    cleanup: identity.cleanup,
  };
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

async function runGit(
  args: string[],
  options: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number }
): Promise<{ stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      env: options.env,
      cwd: options.cwd,
      timeout: options.timeoutMs ?? 120_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { stdout: stdout || '', stderr: stderr || '' };
  } catch (error) {
    throw gitMissingError(error);
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

  let cleanup: (() => Promise<void>) | undefined;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'echo',
  };

  try {
    if (parsed.scheme === 'ssh' && options.keyContent?.trim()) {
      const ssh = await buildGitSshCommand(options.keyContent, parsed.port);
      cleanup = ssh.cleanup;
      env.GIT_SSH_COMMAND = ssh.command;
    }

    const result = await runGit(['ls-remote', '--heads', parsed.url], { env });
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

  let cleanup: (() => Promise<void>) | undefined;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: 'echo',
  };

  try {
    if (parsed.scheme === 'ssh' && options.keyContent?.trim()) {
      const ssh = await buildGitSshCommand(options.keyContent, parsed.port);
      cleanup = ssh.cleanup;
      env.GIT_SSH_COMMAND = ssh.command;
    }

    await runGit(['clone', '--mirror', '--quiet', parsed.url, mirrorDir], {
      env,
      timeoutMs: 15 * 60 * 1000,
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
    throw gitMissingError(error);
  } finally {
    await cleanup?.();
  }
}
