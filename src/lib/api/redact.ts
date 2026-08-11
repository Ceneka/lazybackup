/**
 * Strip secrets from API / MCP responses. Flags tell the UI a secret is stored
 * so edit forms can leave fields blank ("keep existing").
 */

export function redactServer<T extends Record<string, unknown>>(server: T) {
  const { password: _p, privateKey: _k, ...rest } = server as T & {
    password?: string | null;
    privateKey?: string | null;
  };
  return {
    ...rest,
    hasPassword: Boolean(_p),
    hasPrivateKey: Boolean(_k),
  };
}

export function redactS3<T extends Record<string, unknown>>(
  profile: T,
  options?: { maskAccessKeyId?: boolean }
) {
  const { secretAccessKey: _s, accessKeyId, ...rest } = profile as T & {
    secretAccessKey?: string | null;
    accessKeyId?: string | null;
  };
  const mask = options?.maskAccessKeyId === true;
  return {
    ...rest,
    accessKeyId:
      mask && accessKeyId
        ? `${String(accessKeyId).slice(0, 4)}…`
        : accessKeyId ?? undefined,
    hasSecretAccessKey: Boolean(_s),
  };
}

/** Redact nested endpoint secrets and database password on a backup config row. */
export function redactBackup<T extends Record<string, unknown>>(config: T) {
  const copy = { ...config } as Record<string, unknown>;
  if ('dbPassword' in copy) {
    const had = Boolean(copy.dbPassword);
    delete copy.dbPassword;
    copy.hasDbPassword = had;
  }
  if (copy.server && typeof copy.server === 'object') {
    copy.server = redactServer(copy.server as Record<string, unknown>);
  }
  if (copy.destinationServer && typeof copy.destinationServer === 'object') {
    copy.destinationServer = redactServer(
      copy.destinationServer as Record<string, unknown>
    );
  }
  if (copy.sourceS3Profile && typeof copy.sourceS3Profile === 'object') {
    copy.sourceS3Profile = redactS3(
      copy.sourceS3Profile as Record<string, unknown>
    );
  }
  if (copy.destinationS3Profile && typeof copy.destinationS3Profile === 'object') {
    copy.destinationS3Profile = redactS3(
      copy.destinationS3Profile as Record<string, unknown>
    );
  }
  return copy as T & Record<string, unknown>;
}
