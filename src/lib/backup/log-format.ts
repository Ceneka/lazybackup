export const LOG_SECTION = {
  preBackup: '========== Pre-Backup Commands ==========',
  transferRsync: '========== Backup Transfer (rsync) ==========',
  transferScp: '========== Backup Transfer (scp) ==========',
  transferDocker: '========== Docker Volume Backup ==========',
  transferDatabase: '========== Database Dump Backup ==========',
  fileRetention: '========== File Retention ==========',
  warnings: '========== Transfer Warnings ==========',
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
  fileRetentionLog = '',
  transferStderr = ''
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

  const unsafeSymlinks = parseRsyncUnsafeSymlinkWarnings(
    `${transferLog}\n${transferStderr}`
  );
  const warningsLog = buildSymlinkWarningLog(
    unsafeSymlinks,
    `rsync skipped ${unsafeSymlinks.length} symlink(s) that point outside the backed-up tree (--safe-links):`
  );
  if (warningsLog) {
    sections.push(warningsLog);
  }

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

export type UnsafeSymlinkWarning = { name: string; target: string };

/**
 * rsync --safe-links skips symlinks that point outside the transferred tree and
 * prints a line like:
 *   ignoring unsafe symlink "leak" -> "/etc/passwd"
 * It still exits 0, so without parsing these the backup reports a clean
 * success while silently dropping links.
 */
export function parseRsyncUnsafeSymlinkWarnings(text: string): UnsafeSymlinkWarning[] {
  const warnings: UnsafeSymlinkWarning[] = [];
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*ignoring unsafe symlink "(.*)"\s*(?:->|=>)\s*"(.*)"\s*$/.exec(line);
    if (match && match[1]) {
      warnings.push({ name: match[1], target: match[2] });
    }
  }
  return warnings;
}

/** Warning block for symlinks rsync refused / S3 could not store. Empty when none. */
export function buildSymlinkWarningLog(skipped: UnsafeSymlinkWarning[], reason: string): string {
  if (skipped.length === 0) {
    return '';
  }
  return [
    LOG_SECTION.warnings,
    '',
    `WARNING: ${reason}`,
    ...skipped.map((link) => `- ${link.name} -> ${link.target}`),
  ].join('\n');
}

/** Warning lines to append to a transfer log for symlinks skipped by an S3 upload. */
export function buildSkippedSymlinkWarning(paths: string[]): string {
  if (paths.length === 0) {
    return '';
  }
  return [
    `WARNING: ${paths.length} symlink(s) were not uploaded because S3 cannot store symlinks:`,
    ...paths.map((p) => `- ${p}`),
  ].join('\n');
}

export function buildPeerRetentionLog(objectKeys: string[]): string {
  if (objectKeys.length === 0) {
    return '';
  }

  return [
    LOG_SECTION.fileRetention,
    '',
    `Queued ${objectKeys.length} object(s) for bro deletion:`,
    ...objectKeys.map((key) => `- ${key}`),
  ].join('\n');
}

export type ArchiveTransferStats = {
  fileCount: number;
  totalSize: number;
  transferredSize: number;
};

/**
 * Single-archive transfers (database dumps, volume tars, encrypted path archives,
 * instance/ Git packs) log `Size: N bytes` from landLocalFileArtifact. rsync stats
 * do not apply to them, so history would otherwise show 0 files / 0 B.
 */
export function parseArchiveTransferStats(stdout: string): ArchiveTransferStats | null {
  const match = /(?:^|\n)Size: (\d+) bytes(?:\n|$)/.exec(stdout);
  if (!match?.[1]) return null;
  const size = Number(match[1]);
  if (!Number.isSafeInteger(size) || size < 0) return null;
  return { fileCount: 1, totalSize: size, transferredSize: size };
}

/** Methods that land exactly one archive file (not an rsync directory tree). */
export function isArchiveTransferMethod(method: string): boolean {
  return (
    method.startsWith('docker') ||
    method.startsWith('database') ||
    method.startsWith('lazybackup-instance') ||
    method.startsWith('git-mirror') ||
    (method.startsWith('path-') && method.endsWith('-age'))
  );
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
