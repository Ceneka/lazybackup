export type LinkedResource = {
  id: string;
  name: string;
  roles?: string[];
};

/**
 * API conflict (409) when deleting a resource still referenced elsewhere.
 * Carries linkable ids for UI — not just a string message.
 */
export class ResourceInUseError extends Error {
  readonly resources: LinkedResource[];

  constructor(message: string, resources: LinkedResource[]) {
    super(message);
    this.name = 'ResourceInUseError';
    this.resources = resources;
  }
}

export function isResourceInUseError(error: unknown): error is ResourceInUseError {
  return error instanceof ResourceInUseError;
}

/** Parse a DELETE 409 body into ResourceInUseError, or null if not applicable. */
export function resourceInUseFromResponse(
  status: number,
  body: {
    error?: string;
    backups?: LinkedResource[];
    servers?: LinkedResource[];
  } | null,
  fallbackMessage: string
): ResourceInUseError | null {
  if (status !== 409 || !body) return null;
  const resources = body.backups ?? body.servers;
  if (!resources?.length) return null;
  const names = resources.map((r) => r.name).join(', ');
  const message = body.error
    ? `${body.error} (${names})`
    : `${fallbackMessage}: ${names}`;
  return new ResourceInUseError(message, resources);
}
