import { describe, expect, test } from 'bun:test';
import {
  cleanupRemoteVersionDirs,
  createUniqueRemoteVersionDir,
  type RemoteShell,
} from './remote-version-dirs';

type ExecResult = {
  code?: number | null;
  signal?: string | null;
  stdout: string;
  stderr: string;
};

function fakeSsh(options: {
  list?: string[];
  mkdirCode?: number;
  rmCode?: number;
} = {}): { ssh: RemoteShell; commands: string[] } {
  const commands: string[] = [];
  const ssh: RemoteShell = {
    async execCommand(command: string): Promise<ExecResult> {
      commands.push(command);
      if (command.includes(' ls -1 ')) {
        return {
          code: 0,
          stdout: (options.list ?? []).join('\n'),
          stderr: '',
        };
      }
      if (command.includes(' mkdir ')) {
        return {
          code: options.mkdirCode ?? 0,
          signal: null,
          stdout: '',
          stderr: options.mkdirCode ? 'mkdir failed' : '',
        };
      }
      if (command.includes(' rm -rf ')) {
        return {
          code: options.rmCode ?? 0,
          signal: null,
          stdout: '',
          stderr: options.rmCode ? 'rm failed' : '',
        };
      }
      return { code: 0, signal: null, stdout: '', stderr: '' };
    },
  };
  return { ssh, commands };
}

describe('remote version directories expand ~ like rsync', () => {
  test('mkdir targets $HOME instead of a literal ~ directory', async () => {
    const { ssh, commands } = fakeSsh();
    const created = await createUniqueRemoteVersionDir(
      ssh,
      '~/backups',
      '2026-08-07_23-15-01'
    );

    expect(created).toBe('~/backups/2026-08-07_23-15-01');
    const mkdir = commands.find((command) => command.includes(' mkdir -- '));
    expect(mkdir).toContain(`"$HOME"/'backups/2026-08-07_23-15-01'`);
    expect(mkdir).not.toContain(`'~/backups`);
  });

  test('retention lists and removes through $HOME', async () => {
    const { ssh, commands } = fakeSsh({
      list: ['2026-08-07_23-15-01', '2026-08-07_23-15-02'],
    });

    const deleted = await cleanupRemoteVersionDirs(ssh, '~/backups', 1);

    expect(deleted).toEqual(['~/backups/2026-08-07_23-15-01']);
    const ls = commands.find((command) => command.includes(' ls -1 -- '));
    expect(ls).toContain(`"$HOME"/'backups'`);
    const rm = commands.find((command) => command.includes(' rm -rf -- '));
    expect(rm).toContain(`"$HOME"/'backups/2026-08-07_23-15-01'`);
  });

  test('the current version is protected from a future-dated folder', async () => {
    const { ssh, commands } = fakeSsh({
      list: ['2030-01-01_00-00-00', '2026-08-07_23-15-03'],
    });

    const deleted = await cleanupRemoteVersionDirs(ssh, '~/backups', 1, [
      '2026-08-07_23-15-03',
    ]);

    expect(deleted).toEqual([]);
    expect(commands.some((command) => command.includes(' rm -rf -- '))).toBe(false);
  });

  test('a failed remote delete is not reported as removed', async () => {
    const { ssh } = fakeSsh({
      list: ['2026-08-07_23-15-01', '2026-08-07_23-15-02'],
      rmCode: 1,
    });

    expect(await cleanupRemoteVersionDirs(ssh, '/srv/backups', 1)).toEqual([]);
  });
});
