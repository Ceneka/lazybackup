import { describe, expect, test } from 'bun:test';
import {
  formatPreBackupFailureError,
  runPreBackupCommands,
  type PreBackupCommandResult,
} from './pre-backup';

function stubExecutor(
  results: Record<string, PreBackupCommandResult | Error>
): { commands: string[]; execute: (command: string) => Promise<PreBackupCommandResult> } {
  const commands: string[] = [];
  return {
    commands,
    execute: async (command: string) => {
      commands.push(command);
      const result = results[command];
      if (result instanceof Error) throw result;
      return result ?? { stdout: '', stderr: '', code: 0 };
    },
  };
}

function execError(overrides: {
  code?: number | string;
  stdout?: string;
  stderr?: string;
  message?: string;
}): Error {
  return Object.assign(new Error(overrides.message ?? 'command failed'), overrides);
}

describe('runPreBackupCommands', () => {
  test('successful commands return a log and no failures', async () => {
    const { commands, execute } = stubExecutor({
      'echo hi': { stdout: 'hi\n', stderr: '', code: 0 },
    });

    const run = await runPreBackupCommands('echo hi', execute);

    expect(commands).toEqual(['echo hi']);
    expect(run.failures).toEqual([]);
    expect(run.log).toContain('========== Pre-Backup Commands ==========');
    expect(run.log).toContain('$ echo hi');
    expect(run.log).toContain('exit code: 0');
  });

  test('non-zero exit code is reported and logged', async () => {
    const { execute } = stubExecutor({
      'docker stop app': { stdout: '', stderr: 'no such container: app', code: 1 },
    });

    const run = await runPreBackupCommands('docker stop app', execute);

    expect(run.failures).toEqual([
      { command: 'docker stop app', code: 1, stderr: 'no such container: app' },
    ]);
    expect(run.log).toContain('exit code: 1');
    expect(run.log).toContain('--- stderr ---');
    expect(run.log).toContain('no such container: app');
  });

  test('null or undefined exit code is treated as success', async () => {
    const { execute } = stubExecutor({
      one: { stdout: '', stderr: '', code: null },
      two: { stdout: '', stderr: '' },
    });

    const run = await runPreBackupCommands('one\ntwo', execute);

    expect(run.failures).toEqual([]);
  });

  test('a command that throws (local exec) counts as a failure', async () => {
    const { execute } = stubExecutor({
      'pg_dump app': execError({
        code: 2,
        stdout: 'partial',
        stderr: 'connection refused',
      }),
    });

    const run = await runPreBackupCommands('pg_dump app', execute);

    expect(run.failures).toEqual([
      { command: 'pg_dump app', code: 2, stderr: 'connection refused' },
    ]);
    expect(run.log).toContain('exit code: 2');
    expect(run.log).toContain('partial');
    expect(run.log).toContain('connection refused');
  });

  test('an error without a numeric code falls back to the message', async () => {
    const { execute } = stubExecutor({
      broken: execError({ code: 'ENOENT', message: 'spawn broken ENOENT' }),
    });

    const run = await runPreBackupCommands('broken', execute);

    expect(run.failures).toEqual([
      { command: 'broken', code: null, stderr: 'spawn broken ENOENT' },
    ]);
    expect(run.log).toContain('exit code: unknown');
  });

  test('commands after a failure still run', async () => {
    const { commands, execute } = stubExecutor({
      'stop app': { stdout: '', stderr: '', code: 1 },
      'start app': { stdout: 'started', stderr: '', code: 0 },
    });

    const run = await runPreBackupCommands(
      ['stop app', 'dump db', 'start app'].join('\n'),
      async (command) => {
        if (command === 'dump db') throw execError({ code: 1, stderr: 'dump failed' });
        return execute(command);
      }
    );

    expect(commands).toEqual(['stop app', 'start app']);
    expect(run.failures.map((failure) => failure.command)).toEqual(['stop app', 'dump db']);
    expect(run.log).toContain('$ start app');
  });

  test('handles CRLF input and drops blank lines', async () => {
    const { commands, execute } = stubExecutor({});

    const run = await runPreBackupCommands('echo one\r\n\r\necho two\r\n', execute);

    expect(commands).toEqual(['echo one', 'echo two']);
    expect(run.log).not.toContain('\r');
  });

  test('no commands returns an empty log and no failures', async () => {
    const run = await runPreBackupCommands('', async () => ({ stdout: '', stderr: '', code: 0 }));

    expect(run).toEqual({ log: '', failures: [] });
  });
});

describe('formatPreBackupFailureError', () => {
  test('includes the command and exit code', () => {
    const message = formatPreBackupFailureError([
      { command: 'docker stop app', code: 1, stderr: '' },
    ]);

    expect(message).toBe('Pre-backup command failed (exit 1): docker stop app');
  });

  test('appends a one-line truncated stderr detail', () => {
    const message = formatPreBackupFailureError([
      {
        command: 'pg_dump app',
        code: 2,
        stderr: `connection refused\n${'x'.repeat(400)}`,
      },
    ]);

    expect(message.startsWith('Pre-backup command failed (exit 2): pg_dump app — ')).toBe(true);
    expect(message).not.toContain('\n');
    expect(message.length).toBeLessThan(380);
    expect(message).toContain('connection refused x');
  });

  test('lists every failure with a count prefix', () => {
    const message = formatPreBackupFailureError([
      { command: 'stop app', code: 1, stderr: 'not running' },
      { command: 'start app', code: 3, stderr: '' },
    ]);

    expect(message.startsWith('Pre-backup commands failed (2):')).toBe(true);
    expect(message).toContain('- Pre-backup command failed (exit 1): stop app — not running');
    expect(message).toContain('- Pre-backup command failed (exit 3): start app');
  });

  test('reports an unknown exit code', () => {
    const message = formatPreBackupFailureError([{ command: 'x', code: null, stderr: '' }]);

    expect(message).toBe('Pre-backup command failed (exit unknown): x');
  });
});
