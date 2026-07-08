export const LOG_SECTION = {
  preBackup: '========== Pre-Backup Commands ==========',
  transferRsync: '========== Backup Transfer (rsync) ==========',
  transferScp: '========== Backup Transfer (scp) ==========',
} as const;

const TRANSFER_HEADER_RE = /={10} Backup Transfer \((?:rsync|scp)\) ={10}/;

type CommandResult = {
  stdout: string;
  stderr: string;
  code?: number | null;
};

export function formatPreBackupCommandLog(command: string, result: CommandResult): string {
  const lines = [`$ ${command}`, `exit code: ${result.code ?? 'unknown'}`];

  if (result.stdout?.trim()) {
    lines.push('--- stdout ---', result.stdout.trimEnd());
  }

  if (result.stderr?.trim()) {
    lines.push('--- stderr ---', result.stderr.trimEnd());
  }

  if (!result.stdout?.trim() && !result.stderr?.trim()) {
    lines.push('(no output)');
  }

  return lines.join('\n');
}

export function buildPreBackupLog(commandLogs: string[]): string {
  if (commandLogs.length === 0) {
    return '';
  }

  return [LOG_SECTION.preBackup, '', commandLogs.join('\n\n')].join('\n');
}

export function combineBackupLog(
  preBackupLog: string,
  transferLog: string,
  method: 'rsync' | 'scp'
): string {
  const transferHeader =
    method === 'rsync' ? LOG_SECTION.transferRsync : LOG_SECTION.transferScp;

  if (!preBackupLog) {
    return [transferHeader, '', transferLog].join('\n');
  }

  return [preBackupLog, '', transferHeader, '', transferLog].join('\n');
}

export function splitBackupLog(logOutput: string): { preBackup?: string; transfer: string } {
  const transferMatch = logOutput.match(TRANSFER_HEADER_RE);

  if (!transferMatch || transferMatch.index === undefined) {
    return { transfer: logOutput };
  }

  const transferStart = transferMatch.index;
  const transferHeaderEnd = transferStart + transferMatch[0].length;
  const transfer = logOutput.slice(transferHeaderEnd).trimStart();

  if (!logOutput.includes(LOG_SECTION.preBackup)) {
    return { transfer };
  }

  const preStart = logOutput.indexOf(LOG_SECTION.preBackup) + LOG_SECTION.preBackup.length;
  const preBackup = logOutput.slice(preStart, transferStart).trim();

  return {
    preBackup: preBackup || undefined,
    transfer,
  };
}
