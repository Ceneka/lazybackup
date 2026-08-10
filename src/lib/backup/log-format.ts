export const LOG_SECTION = {
  preBackup: '========== Pre-Backup Commands ==========',
  transferRsync: '========== Backup Transfer (rsync) ==========',
  transferScp: '========== Backup Transfer (scp) ==========',
  transferDocker: '========== Docker Volume Backup ==========',
  transferDatabase: '========== Database Dump Backup ==========',
  fileRetention: '========== File Retention ==========',
  restore: '========== Restore ==========',
} as const;

const TRANSFER_HEADER_RE =
  /={10} (?:Backup Transfer \((?:rsync|scp)\)|Docker Volume Backup|Database Dump Backup) ={10}/;

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
  method: string,
  fileRetentionLog = ''
): string {
  const transferHeader =
    method === 'rsync' || method.includes('rsync') || method.includes('local')
      ? LOG_SECTION.transferRsync
      : method === 'scp' || method.includes('scp')
        ? LOG_SECTION.transferScp
        : method.includes('docker')
          ? LOG_SECTION.transferDocker
          : method.includes('database')
            ? LOG_SECTION.transferDatabase
            : LOG_SECTION.transferRsync;

  const sections: string[] = [];

  if (preBackupLog) {
    sections.push(preBackupLog);
  }

  sections.push([transferHeader, '', transferLog].join('\n'));

  if (fileRetentionLog) {
    sections.push(fileRetentionLog);
  }

  return sections.join('\n\n');
}

export function buildFileRetentionLog(deletedFiles: string[]): string {
  if (deletedFiles.length === 0) {
    return '';
  }

  return [
    LOG_SECTION.fileRetention,
    '',
    `Deleted ${deletedFiles.length} file(s):`,
    ...deletedFiles.map((file) => `- ${file}`),
  ].join('\n');
}

export function splitBackupLog(logOutput: string): {
  preBackup?: string;
  transfer: string;
  fileRetention?: string;
} {
  const transferMatch = logOutput.match(TRANSFER_HEADER_RE);

  if (!transferMatch || transferMatch.index === undefined) {
    return { transfer: logOutput };
  }

  const transferStart = transferMatch.index;
  const transferHeaderEnd = transferStart + transferMatch[0].length;
  let afterTransfer = logOutput.slice(transferHeaderEnd).trimStart();

  let fileRetention: string | undefined;
  const retentionIndex = afterTransfer.indexOf(LOG_SECTION.fileRetention);
  if (retentionIndex !== -1) {
    fileRetention = afterTransfer
      .slice(retentionIndex + LOG_SECTION.fileRetention.length)
      .trim() || undefined;
    afterTransfer = afterTransfer.slice(0, retentionIndex).trimEnd();
  }

  const transfer = afterTransfer;

  if (!logOutput.includes(LOG_SECTION.preBackup)) {
    return { transfer, fileRetention };
  }

  const preStart = logOutput.indexOf(LOG_SECTION.preBackup) + LOG_SECTION.preBackup.length;
  const preBackup = logOutput.slice(preStart, transferStart).trim();

  return {
    preBackup: preBackup || undefined,
    transfer,
    fileRetention,
  };
}
