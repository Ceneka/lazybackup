/**
 * Typed restore failures. Routes map these to HTTP status codes instead of
 * matching message substrings, so wording can change without changing status.
 */
export type RestoreErrorCode =
  | 'invalid-request'
  | 'not-found'
  | 'not-restorable'
  | 'artifact-missing'
  | 'artifact-removed'
  | 'destination-missing'
  | 'target-refused'
  | 'target-unwritable'
  | 'decrypt-failed'
  | 'conflict';

export class RestoreError extends Error {
  readonly statusCode: number;
  readonly code: RestoreErrorCode;

  constructor(
    message: string,
    options: { statusCode?: number; code?: RestoreErrorCode; cause?: unknown } = {}
  ) {
    super(message);
    this.name = 'RestoreError';
    this.statusCode = options.statusCode ?? 400;
    this.code = options.code ?? 'invalid-request';
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export class RestoreConflictError extends RestoreError {
  constructor(message: string) {
    super(message, { statusCode: 409, code: 'conflict' });
    this.name = 'RestoreConflictError';
  }
}

export function restoreRequestError(
  message: string,
  code: RestoreErrorCode = 'invalid-request',
  statusCode = 400
): RestoreError {
  return new RestoreError(message, { code, statusCode });
}

export function isRestoreError(error: unknown): error is RestoreError {
  return error instanceof RestoreError;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null
    ? (error as NodeJS.ErrnoException).code
    : undefined;
}

/** EACCES/EPERM (local fs or remote commands) become a readable 400. */
export function translateRestoreWriteError(error: unknown, target: string): Error {
  if (error instanceof RestoreError) return error;

  const code = errorCode(error);
  const message = errorMessage(error);
  if (
    code === 'EACCES' ||
    code === 'EPERM' ||
    code === 'EROFS' ||
    /permission denied|access denied|read-only file system/i.test(message)
  ) {
    return restoreRequestError(
      `Cannot write to restore target ${target}: permission denied`,
      'target-unwritable'
    );
  }
  return error instanceof Error ? error : new Error(message);
}

function isMissingS3ObjectError(error: unknown): boolean {
  const code = errorCode(error);
  const name =
    typeof error === 'object' && error !== null
      ? (error as { name?: string }).name
      : undefined;
  const status =
    typeof error === 'object' && error !== null
      ? (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      : undefined;
  return (
    name === 'NoSuchKey' ||
    name === 'NotFound' ||
    code === 'NoSuchKey' ||
    status === 404 ||
    /specified key does not exist|no such key/i.test(errorMessage(error))
  );
}

/** Map an SDK download failure to a clear artifact-missing message. */
export function mapS3DownloadError(error: unknown, artifactPath: string): Error {
  if (error instanceof RestoreError) return error;
  if (isMissingS3ObjectError(error)) {
    return restoreRequestError(
      `Backup artifact missing from S3: ${artifactPath}`,
      'artifact-missing'
    );
  }
  return error instanceof Error ? error : new Error(errorMessage(error));
}

/** Age failure: do not leak parser internals; explain keys + artifact. */
export function mapAgeDecryptError(error: unknown, artifactName: string): Error {
  if (error instanceof RestoreError) return error;
  return restoreRequestError(
    `None of the keys in your vault (or recovery keys) can decrypt this backup: ${artifactName}`,
    'decrypt-failed'
  );
}

/**
 * HTTP status for a restore failure. Keeps a small legacy fallback for errors
 * thrown by peer/retention modules that are not typed yet.
 */
export function httpStatusForRestoreError(error: unknown): number {
  if (error instanceof RestoreError) return error.statusCode;

  const code = errorCode(error);
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 400;

  const message = errorMessage(error);
  if (
    /artifact removed by retention|re-pair before restoring|Refusing to restore|Only successful|only supported|only for path|no stored artifact|not found on disk|missing from S3/i.test(
      message
    )
  ) {
    return 400;
  }
  return 500;
}
