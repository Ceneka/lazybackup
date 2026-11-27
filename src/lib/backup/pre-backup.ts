import { errorSnippet } from './error-snippet';
import { buildPreBackupLog, formatPreBackupCommandLog } from './log-format';

/** Result of one pre-backup command. `code` null/undefined means it could not be determined. */
export type PreBackupCommandResult = { stdout: string; stderr: string; code?: number | null };

export type PreBackupFailure = { command: string; code: number | null; stderr: string };

export type PreBackupRun = { log: string; failures: PreBackupFailure[] };

const FAILURE_DETAIL_MAX = 300;

/**
 * Run the newline-separated pre-backup commands and report which ones failed.
 *
 * Every command runs even after an earlier one fails: setups like
 * "stop app / dump / start app" need their cleanup commands to run regardless.
 * Failures are returned instead of thrown so the caller can persist the command
 * log on the failed history entry before aborting the backup.
 *
 * `execute` may reject (local `child_process.exec` throws on a non-zero exit) or
 * resolve with a non-zero `code` (remote SSH exec). A null/undefined code is
 * treated as success, matching the rest of the codebase.
 */
export async function runPreBackupCommands(
  commandsText: string,
  execute: (command: string) => Promise<PreBackupCommandResult>,
  options?: { label?: string }
): Promise<PreBackupRun> {
  const commands = commandsText
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter(Boolean);
  const commandLogs: string[] = [];
  const failures: PreBackupFailure[] = [];
  const logPrefix = options?.label ? `${options.label} ` : '';

  for (const command of commands) {
    console.log(`Executing ${logPrefix}command: ${command}`);

    try {
      const result = await execute(command);
      commandLogs.push(formatPreBackupCommandLog(command, result));
      if (result.stderr) {
        console.warn(`Command produced warnings/errors: ${result.stderr}`);
      }
      if (typeof result.code === 'number' && result.code !== 0) {
        failures.push({ command, code: result.code, stderr: result.stderr || '' });
      }
    } catch (err: unknown) {
      const e = err as { code?: unknown; stdout?: string; stderr?: string; message?: string };
      const code = typeof e.code === 'number' ? e.code : null;
      const stderr = e.stderr || e.message || '';
      commandLogs.push(
        formatPreBackupCommandLog(command, {
          code,
          stdout: e.stdout || '',
          stderr,
        })
      );
      failures.push({ command, code, stderr });
    }
  }

  return { log: buildPreBackupLog(commandLogs), failures };
}

/**
 * Compact error message for the history entry and failure webhook. Stderr is
 * collapsed to one line and truncated so the message stays readable.
 */
export function formatPreBackupFailureError(failures: PreBackupFailure[]): string {
  if (failures.length === 0) {
    return 'Pre-backup command failed';
  }

  const lines = failures.map((failure) => {
    const code = failure.code === null ? 'unknown' : String(failure.code);
    const command = failure.command.trim() || '(empty command)';
    const detail = errorSnippet(failure.stderr, FAILURE_DETAIL_MAX);
    return detail
      ? `Pre-backup command failed (exit ${code}): ${command} — ${detail}`
      : `Pre-backup command failed (exit ${code}): ${command}`;
  });

  if (lines.length === 1) {
    return lines[0];
  }

  return [`Pre-backup commands failed (${lines.length}):`, ...lines.map((line) => `- ${line}`)].join(
    '\n'
  );
}
